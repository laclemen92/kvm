import { assertEquals, assertExists } from "jsr:@std/assert";
import { z } from "zod";
import { createModelClass } from "./model.ts";
import type { KVMEntity } from "./types.ts";

// Test entity
const postEntity: KVMEntity = {
  name: "post",
  primaryKey: [{ name: "post", key: "id" }],
  schema: z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    authorId: z.string(),
    publishedAt: z.string(),
    views: z.number().optional(),
    tags: z.array(z.string()).optional(),
  }),
};

Deno.test("Model list operations - basic list", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create test posts
  const posts = [
    {
      id: "post1",
      title: "First Post",
      content: "Content 1",
      authorId: "author1",
      publishedAt: "2024-01-01T00:00:00Z",
      views: 100,
    },
    {
      id: "post2",
      title: "Second Post",
      content: "Content 2",
      authorId: "author2",
      publishedAt: "2024-01-02T00:00:00Z",
      views: 200,
    },
    {
      id: "post3",
      title: "Third Post",
      content: "Content 3",
      authorId: "author1",
      publishedAt: "2024-01-03T00:00:00Z",
      views: 150,
    },
  ];

  for (const post of posts) {
    await Post.create(post);
  }

  // Test basic list
  const result = await Post.list({ limit: 2 });

  assertEquals(result.data.length, 2);
  assertEquals(result.count, 2);
  assertExists(result.hasMore);

  // Verify model instances
  assertEquals(typeof result.data[0].save, "function");
  assertEquals(typeof result.data[0].delete, "function");

  kv.close();
});

Deno.test("Model list operations - list range with custom keys", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create posts and custom indexed entries
  const posts = [
    {
      id: "post1",
      title: "Post A",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-01T00:00:00Z",
      views: 50,
    },
    {
      id: "post2",
      title: "Post B",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-02T00:00:00Z",
      views: 100,
    },
    {
      id: "post3",
      title: "Post C",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-03T00:00:00Z",
      views: 200,
    },
  ];

  for (const post of posts) {
    await Post.create(post);
    // Create view-indexed entries for range queries
    await kv.set(["post", "by_views", post.views, post.id], post);
  }

  // Test range query by views (50-150)
  const startKey = ["post", "by_views", 50];
  const endKey = ["post", "by_views", 150];

  const result = await Post.listRange(startKey, endKey, { limit: 10 });

  assertEquals(result.data.length, 2); // Should find posts with 50 and 100 views

  const views = result.data.map((post) => post.views).sort((a, b) => a - b);
  assertEquals(views, [50, 100]);

  kv.close();
});

Deno.test("Model list operations - list by prefix", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create posts and author-indexed entries
  const posts = [
    {
      id: "post1",
      title: "Post 1",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "post2",
      title: "Post 2",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-02T00:00:00Z",
    },
    {
      id: "post3",
      title: "Post 3",
      content: "Content",
      authorId: "author2",
      publishedAt: "2024-01-03T00:00:00Z",
    },
  ];

  for (const post of posts) {
    await Post.create(post);
    // Create author-indexed entries
    await kv.set(["post", "by_author", post.authorId, post.id], post);
  }

  // Find all posts by author1
  const result = await Post.listByPrefix(["post", "by_author", "author1"], {
    limit: 10,
  });

  assertEquals(result.data.length, 2);

  // All results should be by author1
  const authorIds = result.data.map((post) => post.authorId);
  assertEquals(authorIds.every((id) => id === "author1"), true);

  kv.close();
});

Deno.test("Model list operations - list by date range", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create posts with different publish dates
  const posts = [
    {
      id: "post1",
      title: "January Post",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "post2",
      title: "February Post",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-02-15T00:00:00Z",
    },
    {
      id: "post3",
      title: "March Post",
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-03-15T00:00:00Z",
    },
  ];

  for (const post of posts) {
    await Post.create(post);
    // Create date-indexed entries for date range queries
    await kv.set(["post", "by_date", post.publishedAt, post.id], post);
  }

  // Find posts from January to February
  const result = await Post.listByDateRange({
    field: "by_date",
    start: "2024-01-01T00:00:00Z",
    end: "2024-02-28T23:59:59Z",
    limit: 10,
  });

  assertEquals(result.data.length, 2);

  const titles = result.data.map((post) => post.title).sort();
  assertEquals(titles, ["February Post", "January Post"]);

  kv.close();
});

Deno.test("Model list operations - streaming large datasets", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create 25 posts
  for (let i = 0; i < 25; i++) {
    await Post.create({
      id: `post${i.toString().padStart(3, "0")}`,
      title: `Post ${i}`,
      content: `Content for post ${i}`,
      authorId: `author${i % 5}`, // 5 different authors
      publishedAt: new Date(2024, 0, 1 + i).toISOString(),
    });
  }

  // Test streaming with small batch size
  let streamCount = 0;
  const streamedPosts = [];

  // Add timeout to prevent hanging
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Stream test timed out after 5 seconds")),
      5000,
    );
  });

  const streamPromise = (async () => {
    for await (const post of Post.listStream({ batchSize: 5 })) {
      streamCount++;
      streamedPosts.push(post);

      // Verify it's a model instance
      assertEquals(typeof post.save, "function");
      assertEquals(typeof post.delete, "function");
    }
  })();

  try {
    await Promise.race([streamPromise, timeoutPromise]);
  } finally {
    // Always clear the timeout to prevent timer leaks
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }

  assertEquals(streamCount, 25);
  assertEquals(streamedPosts.length, 25);

  kv.close();
});

Deno.test("Model list operations - count", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create 5 posts
  for (let i = 0; i < 5; i++) {
    await Post.create({
      id: `post${i}`,
      title: `Post ${i}`,
      content: "Content",
      authorId: "author1",
      publishedAt: new Date(2024, 0, 1 + i).toISOString(),
    });
  }

  const totalCount = await Post.count();
  assertEquals(totalCount, 5);

  // Count with prefix filter
  const prefixCount = await Post.count({ prefix: ["post"] });
  assertEquals(prefixCount, 5);

  kv.close();
});

Deno.test("Model list operations - pagination", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create 7 posts
  for (let i = 0; i < 7; i++) {
    await Post.create({
      id: `post${i}`,
      title: `Post ${i}`,
      content: "Content",
      authorId: "author1",
      publishedAt: new Date(2024, 0, 1 + i).toISOString(),
    });
  }

  // Test offset-based pagination
  const page1 = await Post.paginate({ page: 1, pageSize: 3 });

  assertEquals(page1.data.length, 3);
  assertEquals(page1.pagination.page, 1);
  assertEquals(page1.pagination.pageSize, 3);
  assertEquals(page1.pagination.hasNextPage, true);
  assertEquals(page1.pagination.hasPreviousPage, false);

  // Verify model instances
  assertEquals(typeof page1.data[0].save, "function");

  const page2 = await Post.paginate({ page: 2, pageSize: 3 });

  assertEquals(page2.data.length, 3);
  assertEquals(page2.pagination.page, 2);
  assertEquals(page2.pagination.hasNextPage, true);
  assertEquals(page2.pagination.hasPreviousPage, true);

  const page3 = await Post.paginate({ page: 3, pageSize: 3 });

  assertEquals(page3.data.length, 1); // Last page has only 1 item
  assertEquals(page3.pagination.hasNextPage, false);

  kv.close();
});

Deno.test("Model list operations - cursor-based pagination", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create 6 posts
  for (let i = 0; i < 6; i++) {
    await Post.create({
      id: `post${i}`,
      title: `Post ${i}`,
      content: "Content",
      authorId: "author1",
      publishedAt: new Date(2024, 0, 1 + i).toISOString(),
    });
  }

  // First page
  const page1 = await Post.paginate({ pageSize: 2 });
  assertEquals(page1.data.length, 2);

  // Get next page using cursor if available
  if (page1.pagination.hasNextPage) {
    const page2 = await Post.paginate({
      pageSize: 2,
      cursor: page1.pagination.nextCursor,
    });
    assertEquals(page2.data.length, 2);

    // Verify no overlap
    const page1Ids = page1.data.map((post) => post.id);
    const page2Ids = page2.data.map((post) => post.id);
    const intersection = page1Ids.filter((id) => page2Ids.includes(id));
    assertEquals(intersection.length, 0);
  }

  kv.close();
});

Deno.test("Model list operations - consistency levels", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create a few posts
  for (let i = 0; i < 3; i++) {
    await Post.create({
      id: `post${i}`,
      title: `Post ${i}`,
      content: "Content",
      authorId: "author1",
      publishedAt: new Date(2024, 0, 1 + i).toISOString(),
    });
  }

  // Test eventual consistency
  const eventualResult = await Post.list({
    consistency: "eventual",
    limit: 10,
  });
  assertEquals(eventualResult.data.length, 3);

  // Test strong consistency
  const strongResult = await Post.list({
    consistency: "strong",
    limit: 10,
  });
  assertEquals(strongResult.data.length, 3);

  kv.close();
});

Deno.test("Model list operations - reverse ordering", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create posts with predictable IDs
  const posts = ["post1", "post2", "post3"];
  for (const id of posts) {
    await Post.create({
      id,
      title: `Title for ${id}`,
      content: "Content",
      authorId: "author1",
      publishedAt: "2024-01-01T00:00:00Z",
    });
  }

  // Get normal order
  const normalResult = await Post.list({ reverse: false, limit: 10 });
  const normalIds = normalResult.data.map((post) => post.id);

  // Get reverse order
  const reverseResult = await Post.list({ reverse: true, limit: 10 });
  const reverseIds = reverseResult.data.map((post) => post.id);

  // Reverse order should be opposite of normal
  assertEquals(reverseIds, normalIds.reverse());

  kv.close();
});
