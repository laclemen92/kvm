import type { KVMEntity } from "./types.ts";
import type { ZodRawShape } from "zod";
import type {
  SSEOptions,
  WatchCallback,
  WatchEvent,
  WatchEventType,
  WatchOptions,
  WatchState,
  WebSocketOptions,
} from "./watch-types.ts";
import { WatchEventType as EventType } from "./watch-types.ts";
import { buildPrimaryKey } from "./utils.ts";

/**
 * Utility functions for working with watch streams
 */
export class WatchUtils {
  /**
   * Create a watch event from KV entry data
   */
  static createEvent<T>(
    type: WatchEventType,
    key: Deno.KvKey,
    value: T | null,
    versionstamp: string | null,
    modelName: string,
    previousValue?: T | null,
  ): WatchEvent<T> {
    return {
      type,
      key,
      value,
      previousValue,
      versionstamp,
      timestamp: new Date(),
      modelName,
    };
  }

  /**
   * Determine the event type based on current and previous values
   */
  static determineEventType<T>(
    currentValue: T | null,
    previousValue: T | null,
    isInitial = false,
  ): WatchEventType {
    if (isInitial) {
      return EventType.INITIAL;
    }

    // Normalize undefined to null for comparison
    const normalizedCurrent = currentValue === undefined ? null : currentValue;
    const normalizedPrevious = previousValue === undefined
      ? null
      : previousValue;

    if (normalizedPrevious === null && normalizedCurrent !== null) {
      return EventType.CREATED;
    }

    if (normalizedPrevious !== null && normalizedCurrent === null) {
      return EventType.DELETED;
    }

    return EventType.UPDATED;
  }

  /**
   * Generate key for watching a specific record
   */
  static generateWatchKey<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    id: string | Record<string, any>,
  ): Deno.KvKey {
    if (typeof id === "string") {
      // Simple primary key
      const primaryKeyDef = entity.primaryKey[0];
      if (!primaryKeyDef.key) {
        // No key field, build manually for watch case
        const primaryKey: Deno.KvKeyPart[] = [];
        entity.primaryKey.forEach((keyPart) => {
          if (keyPart.name) {
            primaryKey.push(keyPart.name);
          }
        });
        primaryKey.push(id);
        return primaryKey;
      }
      return buildPrimaryKey(entity.primaryKey, { [primaryKeyDef.key]: id });
    } else {
      // Composite primary key
      return buildPrimaryKey(entity.primaryKey, id);
    }
  }

  /**
   * Generate multiple keys for batch watching
   */
  static generateWatchKeys<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    ids: (string | Record<string, any>)[],
  ): Deno.KvKey[] {
    return ids.map((id) => this.generateWatchKey(entity, id));
  }

  /**
   * Create a Server-Sent Events response from a watch stream
   */
  static createSSEResponse<T>(
    stream: ReadableStream<WatchEvent<T>>,
    options: SSEOptions = {},
  ): Response {
    const {
      eventName = "kvm-change",
      includeMetadata = true,
      serializer,
      heartbeatInterval = 30000,
    } = options;

    const encoder = new TextEncoder();
    let heartbeatTimer: number | undefined;

    const sseStream = new ReadableStream({
      start(controller) {
        // Send initial headers
        controller.enqueue(encoder.encode("retry: 1000\n\n"));

        // Setup heartbeat
        if (heartbeatInterval > 0) {
          heartbeatTimer = setInterval(() => {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }, heartbeatInterval);
        }
      },

      async pull(controller) {
        const reader = stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            let data: string;
            if (serializer) {
              data = serializer(value);
            } else {
              const eventData = includeMetadata
                ? value
                : { value: value.value, type: value.type };
              data = JSON.stringify(eventData);
            }

            const sseMessage = `event: ${eventName}\ndata: ${data}\n\n`;
            controller.enqueue(encoder.encode(sseMessage));
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
          }
        }
      },

      cancel() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      },
    });
  }

  /**
   * Create a WebSocket handler from a watch stream
   */
  static createWebSocketHandler<T>(
    stream: ReadableStream<WatchEvent<T>>,
    options: WebSocketOptions = {},
  ): (socket: WebSocket) => void {
    const {
      messageType = "kvm-change",
      includeMetadata = true,
      serializer,
      enablePing = true,
      pingInterval = 30000,
    } = options;

    return (socket: WebSocket) => {
      let pingTimer: number | undefined;
      let streamReader: ReadableStreamDefaultReader<WatchEvent<T>> | undefined;

      socket.onopen = () => {
        // Setup ping/pong for connection health
        if (enablePing && pingInterval > 0) {
          pingTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              // Note: ping() method may not be available in all WebSocket implementations
              // socket.ping();
            }
          }, pingInterval);
        }

        // Start reading from stream
        streamReader = stream.getReader();
        readStream();
      };

      socket.onclose = () => {
        cleanup();
      };

      socket.onerror = () => {
        cleanup();
      };

      const cleanup = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
        }
        if (streamReader) {
          streamReader.releaseLock();
        }
      };

      const readStream = async () => {
        if (!streamReader) return;

        try {
          while (socket.readyState === WebSocket.OPEN) {
            const { done, value } = await streamReader.read();

            if (done) {
              break;
            }

            let data: string;
            if (serializer) {
              data = serializer(value);
            } else {
              const eventData = includeMetadata
                ? value
                : { value: value.value, type: value.type };
              data = JSON.stringify({ type: messageType, data: eventData });
            }

            socket.send(data);
          }
        } catch (error) {
          console.error("Watch stream error:", error);
          socket.close(1011, "Stream error");
        }
      };
    };
  }

  /**
   * Merge multiple watch streams into a single stream
   */
  static mergeStreams<T>(
    streams: ReadableStream<WatchEvent<T>>[],
  ): ReadableStream<WatchEvent<T>> {
    return new ReadableStream({
      start(controller) {
        const readers = streams.map((stream) => stream.getReader());

        const readFromAll = async () => {
          const promises = readers.map(async (reader, index) => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  return { done: true, value: null, index };
                }
                return { done: false, value, index };
              }
            } catch (error) {
              return { done: true, value: null, index, error };
            }
          });

          try {
            for await (const result of promises) {
              if (!result.done && result.value) {
                controller.enqueue(result.value);
              } else if (result.error) {
                controller.error(result.error);
                return;
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        };

        readFromAll();
      },
    });
  }

  /**
   * Filter watch events based on a predicate
   */
  static filterStream<T>(
    stream: ReadableStream<WatchEvent<T>>,
    predicate: (event: WatchEvent<T>) => boolean,
  ): ReadableStream<WatchEvent<T>> {
    return new ReadableStream({
      start(controller) {
        const reader = stream.getReader();

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                controller.close();
                break;
              }

              if (predicate(value)) {
                controller.enqueue(value);
              }
            }
          } catch (error) {
            controller.error(error);
          } finally {
            reader.releaseLock();
          }
        };

        processStream();
      },
    });
  }

  /**
   * Transform watch events using a mapper function
   */
  static mapStream<T, U>(
    stream: ReadableStream<WatchEvent<T>>,
    mapper: (event: WatchEvent<T>) => WatchEvent<U>,
  ): ReadableStream<WatchEvent<U>> {
    return new ReadableStream({
      start(controller) {
        const reader = stream.getReader();

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                controller.close();
                break;
              }

              const mappedValue = mapper(value);
              controller.enqueue(mappedValue);
            }
          } catch (error) {
            controller.error(error);
          } finally {
            reader.releaseLock();
          }
        };

        processStream();
      },
    });
  }

  /**
   * Create a debounced version of a watch stream
   */
  static debounceStream<T>(
    stream: ReadableStream<WatchEvent<T>>,
    delay: number,
  ): ReadableStream<WatchEvent<T>> {
    return new ReadableStream({
      start(controller) {
        const reader = stream.getReader();
        let timeout: number | undefined;
        let lastEvent: WatchEvent<T> | undefined;

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                if (lastEvent) {
                  controller.enqueue(lastEvent);
                }
                controller.close();
                break;
              }

              lastEvent = value;

              if (timeout) {
                clearTimeout(timeout);
              }

              timeout = setTimeout(() => {
                if (lastEvent) {
                  controller.enqueue(lastEvent);
                  lastEvent = undefined;
                }
              }, delay);
            }
          } catch (error) {
            controller.error(error);
          } finally {
            reader.releaseLock();
            if (timeout) {
              clearTimeout(timeout);
            }
          }
        };

        processStream();
      },
    });
  }
}
