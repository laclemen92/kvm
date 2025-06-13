/**
 * Middleware/Hooks implementation for KVM ORM
 */

import type {
  HookContext,
  HookExecutionResult,
  HookFunction,
  HookManager,
  HookOptions,
  HookTiming,
  HookType,
  Plugin,
  PostHookFunction,
  PreHookFunction,
  RegisteredHook,
} from "./middleware-types.ts";
import { HookExecutionError, HookTimeoutError } from "./middleware-types.ts";
import type { ModelDocument } from "./model-types.ts";

/**
 * Default hook options
 */
const DEFAULT_HOOK_OPTIONS: Required<HookOptions> = {
  priority: 0,
  parallel: false,
  timeout: 5000,
  tags: [],
  enabled: true,
};

/**
 * Implementation of the hook manager
 */
export class KVMHookManager<T = any> implements HookManager<T> {
  private hooks: RegisteredHook<T>[] = [];
  private enabled = true;
  private hookIdCounter = 0;

  /**
   * Register a pre-hook
   */
  pre(type: HookType, fn: PreHookFunction<T>, options: HookOptions = {}): void {
    this.registerHook("pre", type, fn, options);
  }

  /**
   * Register a post-hook
   */
  post(
    type: HookType,
    fn: PostHookFunction<T>,
    options: HookOptions = {},
  ): void {
    this.registerHook("post", type, fn, options);
  }

  /**
   * Register a hook with timing
   */
  private registerHook(
    timing: HookTiming,
    type: HookType,
    fn: HookFunction<T>,
    options: HookOptions,
  ): void {
    const hook: RegisteredHook<T> = {
      id: this.generateHookId(),
      timing,
      type,
      fn,
      options: { ...DEFAULT_HOOK_OPTIONS, ...options },
    };

    this.hooks.push(hook);

    // Sort hooks by priority (higher priority first)
    this.hooks.sort((a, b) =>
      (b.options.priority || 0) - (a.options.priority || 0)
    );
  }

  /**
   * Generate unique hook ID
   */
  private generateHookId(): string {
    return `hook_${++this.hookIdCounter}_${Date.now()}`;
  }

  /**
   * Remove a hook by ID
   */
  removeHook(id: string): boolean {
    const initialLength = this.hooks.length;
    this.hooks = this.hooks.filter((hook) => hook.id !== id);
    return this.hooks.length < initialLength;
  }

  /**
   * Remove all hooks of a specific type
   */
  removeHooks(type: HookType, timing?: HookTiming): number {
    const initialLength = this.hooks.length;
    this.hooks = this.hooks.filter((hook) => {
      if (hook.type !== type) return true;
      if (timing && hook.timing !== timing) return true;
      return false;
    });
    return initialLength - this.hooks.length;
  }

  /**
   * Get all registered hooks
   */
  getHooks(type?: HookType, timing?: HookTiming): RegisteredHook<T>[] {
    return this.hooks.filter((hook) => {
      if (type && hook.type !== type) return false;
      if (timing && hook.timing !== timing) return false;
      return true;
    });
  }

  /**
   * Execute pre-hooks for a given operation
   */
  async executePreHooks(
    type: HookType,
    context: HookContext<T>,
    document?: ModelDocument<T> & T,
  ): Promise<HookExecutionResult> {
    if (!this.enabled) {
      return this.createSuccessResult(0);
    }

    const preHooks = this.getHooks(type, "pre").filter((hook) =>
      hook.options.enabled
    );

    if (preHooks.length === 0) {
      return this.createSuccessResult(0);
    }

    const startTime = Date.now();
    const errors: Error[] = [];
    let executed = 0;
    let skipped = 0;

    // Separate parallel and sequential hooks
    const parallelHooks = preHooks.filter((hook) => hook.options.parallel);
    const sequentialHooks = preHooks.filter((hook) => !hook.options.parallel);

    try {
      // Execute parallel hooks
      if (parallelHooks.length > 0) {
        const parallelResults = await Promise.allSettled(
          parallelHooks.map((hook) =>
            this.executePreHook(hook, context, document)
          ),
        );

        for (let i = 0; i < parallelResults.length; i++) {
          const result = parallelResults[i];
          if (result.status === "fulfilled") {
            executed++;
          } else {
            errors.push(result.reason);
            skipped++;
          }
        }
      }

      // Execute sequential hooks
      for (const hook of sequentialHooks) {
        try {
          await this.executePreHook(hook, context, document);
          executed++;
        } catch (error) {
          errors.push(error as Error);
          skipped++;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: errors.length === 0,
        errors,
        duration,
        executed,
        skipped,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        errors: [error as Error],
        duration,
        executed,
        skipped: preHooks.length - executed,
      };
    }
  }

  /**
   * Execute a single pre-hook
   */
  private async executePreHook(
    hook: RegisteredHook<T>,
    context: HookContext<T>,
    document?: ModelDocument<T> & T,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new HookTimeoutError(hook.id, hook.options.timeout || 0));
      }, hook.options.timeout);

      const next = (error?: Error) => {
        clearTimeout(timeoutId);
        if (error) {
          reject(
            new HookExecutionError(
              hook.id,
              hook.type,
              hook.timing,
              error,
              context,
            ),
          );
        } else {
          resolve();
        }
      };

      try {
        const result = (hook.fn as PreHookFunction<T>).call(
          document,
          context,
          next,
        );

        // Handle async hooks that return a promise
        if (result && typeof result.then === "function") {
          result.then(() => {
            // If the hook didn't call next(), call it automatically
            next();
          }).catch(next);
        }
      } catch (error) {
        next(error as Error);
      }
    });
  }

  /**
   * Execute post-hooks for a given operation
   */
  async executePostHooks(
    type: HookType,
    context: HookContext<T>,
    result: any,
    document?: ModelDocument<T> & T,
  ): Promise<HookExecutionResult> {
    if (!this.enabled) {
      return this.createSuccessResult(0);
    }

    const postHooks = this.getHooks(type, "post").filter((hook) =>
      hook.options.enabled
    );

    if (postHooks.length === 0) {
      return this.createSuccessResult(0);
    }

    const startTime = Date.now();
    const errors: Error[] = [];
    let executed = 0;
    let skipped = 0;

    // Separate parallel and sequential hooks
    const parallelHooks = postHooks.filter((hook) => hook.options.parallel);
    const sequentialHooks = postHooks.filter((hook) => !hook.options.parallel);

    try {
      // Execute parallel hooks
      if (parallelHooks.length > 0) {
        const parallelResults = await Promise.allSettled(
          parallelHooks.map((hook) =>
            this.executePostHook(hook, context, result, document)
          ),
        );

        for (let i = 0; i < parallelResults.length; i++) {
          const result = parallelResults[i];
          if (result.status === "fulfilled") {
            executed++;
          } else {
            errors.push(result.reason);
            skipped++;
          }
        }
      }

      // Execute sequential hooks
      for (const hook of sequentialHooks) {
        try {
          await this.executePostHook(hook, context, result, document);
          executed++;
        } catch (error) {
          errors.push(error as Error);
          skipped++;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: errors.length === 0,
        errors,
        duration,
        executed,
        skipped,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        errors: [error as Error],
        duration,
        executed,
        skipped: postHooks.length - executed,
      };
    }
  }

  /**
   * Execute a single post-hook
   */
  private async executePostHook(
    hook: RegisteredHook<T>,
    context: HookContext<T>,
    result: any,
    document?: ModelDocument<T> & T,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new HookTimeoutError(hook.id, hook.options.timeout || 0));
      }, hook.options.timeout);

      try {
        const hookResult = (hook.fn as PostHookFunction<T>).call(
          document,
          context,
          result,
        );

        // Handle async hooks
        if (hookResult && typeof hookResult.then === "function") {
          hookResult.then(() => {
            clearTimeout(timeoutId);
            resolve();
          }).catch((error) => {
            clearTimeout(timeoutId);
            reject(
              new HookExecutionError(
                hook.id,
                hook.type,
                hook.timing,
                error,
                context,
              ),
            );
          });
        } else {
          clearTimeout(timeoutId);
          resolve();
        }
      } catch (error) {
        clearTimeout(timeoutId);
        reject(
          new HookExecutionError(
            hook.id,
            hook.type,
            hook.timing,
            error as Error,
            context,
          ),
        );
      }
    });
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
    this.hooks = [];
  }

  /**
   * Enable/disable hooks globally
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if hooks are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create a success result
   */
  private createSuccessResult(executed: number): HookExecutionResult {
    return {
      success: true,
      errors: [],
      duration: 0,
      executed,
      skipped: 0,
    };
  }

  /**
   * Install a plugin
   */
  use(plugin: Plugin<T>, options?: Record<string, any>): void {
    plugin.install(this, options);
  }

  /**
   * Uninstall a plugin
   */
  unuse(plugin: Plugin<T>): void {
    if (plugin.uninstall) {
      plugin.uninstall(this);
    }
  }
}

/**
 * Built-in plugins
 */

/**
 * Timestamps plugin - automatically adds createdAt and updatedAt fields
 */
export function timestampsPlugin<T = any>(options: {
  createdAt?: string;
  updatedAt?: string;
} = {}): Plugin<T> {
  const { createdAt = "createdAt", updatedAt = "updatedAt" } = options;

  return {
    name: "timestamps",
    version: "1.0.0",
    install(hooks: HookManager<T>) {
      // Add createdAt on create
      hooks.pre("create", function (context, next) {
        if (
          context.input &&
          !context.input[createdAt as keyof typeof context.input]
        ) {
          (context.input as any)[createdAt] = new Date();
        }
        next();
      });

      // Add updatedAt on save (create or update)
      hooks.pre("save", function (context, next) {
        if (context.input || this) {
          const target = context.input || this;
          if (target) {
            (target as any)[updatedAt] = new Date();
          }
        }
        next();
      });

      // Add updatedAt on update
      hooks.pre("update", function (context, next) {
        if (context.input) {
          (context.input as any)[updatedAt] = new Date();
        }
        next();
      });
    },
  };
}

/**
 * Validation plugin - adds custom validation rules
 */
export function validationPlugin<T = any>(options: {
  rules?: Record<
    string,
    (value: any, document: any) => boolean | Promise<boolean>
  >;
  stopOnFirstError?: boolean;
} = {}): Plugin<T> {
  const { rules = {}, stopOnFirstError = true } = options;

  return {
    name: "validation",
    version: "1.0.0",
    install(hooks: HookManager<T>) {
      hooks.pre("validate", async function (context, next) {
        const document = this || context.input;
        if (!document) {
          return next();
        }

        const errors: string[] = [];

        for (const [field, validator] of Object.entries(rules)) {
          try {
            const value = (document as any)[field];
            const isValid = await validator(value, document);

            if (!isValid) {
              errors.push(`Validation failed for field '${field}'`);
              if (stopOnFirstError) {
                break;
              }
            }
          } catch (error) {
            errors.push(
              `Validation error for field '${field}': ${
                (error as Error).message
              }`,
            );
            if (stopOnFirstError) {
              break;
            }
          }
        }

        if (errors.length > 0) {
          return next(new Error(errors.join(", ")));
        }

        next();
      });
    },
  };
}

/**
 * Audit plugin - tracks who created/updated records
 */
export function auditPlugin<T = any>(options: {
  getCurrentUser?: () => string | Promise<string>;
  createdBy?: string;
  updatedBy?: string;
} = {}): Plugin<T> {
  const {
    getCurrentUser = () => "system",
    createdBy = "createdBy",
    updatedBy = "updatedBy",
  } = options;

  return {
    name: "audit",
    version: "1.0.0",
    install(hooks: HookManager<T>) {
      // Add createdBy on create
      hooks.pre("create", async function (context, next) {
        if (context.input) {
          try {
            const userId = await getCurrentUser();
            (context.input as any)[createdBy] = userId;
          } catch (error) {
            return next(error as Error);
          }
        }
        next();
      });

      // Add updatedBy on update
      hooks.pre("update", async function (context, next) {
        if (context.input) {
          try {
            const userId = await getCurrentUser();
            (context.input as any)[updatedBy] = userId;
          } catch (error) {
            return next(error as Error);
          }
        }
        next();
      });
    },
  };
}
