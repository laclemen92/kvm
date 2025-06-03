import { RelationType, ValueType } from "./types.ts";
import type { KVMEntity } from "./types.ts";
import { z } from "zod";

const userSchema = z.object({
  id: z.string(),
  email: z.string().email("Invalid email format"),
  age: z.number(),
  sessionId: z.string(),
}).strict();
export const userEntity: KVMEntity<typeof userSchema.shape> = {
  primaryKey: [{
    name: "users",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "users_by_email",
    key: [{
      name: "users_by_email",
      key: "email",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }, {
    name: "users_by_session",
    key: [{
      name: "users_by_session",
      key: "sessionId",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  schema: userSchema,
  name: "users",
};
export const userByValueEntity: KVMEntity<typeof userSchema.shape> = {
  primaryKey: [{
    name: "users",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "users_by_email",
    key: [{
      name: "users_by_email",
      key: "email",
    }],
    valueType: ValueType.VALUE,
    valueKey: "id",
  }, {
    name: "users_by_session",
    key: [{
      name: "users_by_session",
      key: "sessionId",
    }],
    valueType: ValueType.VALUE,
    valueKey: "id",
  }],
  schema: userSchema,
  name: "users",
};

const postSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  userId: z.string(),
  content: z.string(),
  // comments: z.array(commentSchema),
}).strict();
export const postEntity: KVMEntity<typeof postSchema.shape> = {
  name: "posts",
  primaryKey: [{
    name: "posts",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "posts_by_slug",
    key: [
      {
        name: "posts_by_slug",
        key: "slug",
      },
    ],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  relations: [{
    entityName: userEntity.name,
    fields: ["userId"],
    valueType: ValueType.VALUE,
    type: "one-to-many",
  }],
  schema: postSchema,
};
const commentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  text: z.string(),
  postId: z.string(),
});
export const commentEntity: KVMEntity<typeof commentSchema.shape> = {
  name: "comments",
  relations: [
    {
      entityName: postEntity.name, //postEntity,
      fields: ["postId"],
      valueType: ValueType.VALUE,
      type: "one-to-many",
    },
  ],
  primaryKey: [{
    name: "comments",
    key: "id",
    // relation:
  }],
  secondaryIndexes: [{
    name: "comments_by_postId",
    key: [
      {
        name: "comments_by_postId",
        key: "postId",
      },
    ],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  schema: commentSchema,
};

// how would this get structured for me?
// ["products", "electronics", "smartphones", "apple"]
// I should be able to query by this and when I create a product, it should get
// categorized correctly
const productSchema = z.object({
  id: z.string(),
  sku: z.string(),
  brand: z.string(),
  category: z.string(),
  subcategory: z.string(),
  price: z.number(),
  name: z.string(),
});
export const productEntity: KVMEntity<typeof productSchema.shape> = {
  name: "products",
  primaryKey: [{
    name: "products",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "productsByCategorySubcategoryBrand",
    key: [
      {
        name: "products",
        key: "category",
      }, // {
      //   key: "category",
      // },
      {
        key: "subcategory",
      },
      {
        key: "brand",
      },
      {
        key: "name",
      },
    ],
    valueKey: "id", // storing the id of the product here
    valueType: ValueType.KEY,
  }],
  schema: productSchema,
};

// create a many to many
// categories and posts.

const categorySchema = z.object({
  name: z.string(),
  id: z.string(),
  postId: z.string(),
});
export const categoryEntity: KVMEntity<typeof categorySchema.shape> = {
  name: "categories",
  primaryKey: [{
    name: "posts",
    key: "id",
  }],
  relations: [
    {
      entityName: "posts",
      fields: ["postId"],
      type: ValueType.KEY,
    },
  ],
  secondaryIndexes: [{
    name: "posts_by_userId",
    key: [
      {
        name: "posts_by_userId",
        key: "userId",
      },
    ],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  schema: categorySchema,
};

const manyProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  brand: z.string(),
  categoryId: z.string(),
  subcategory: z.string(),
  price: z.number(),
  name: z.string(),
});
export const manyProductEntity: KVMEntity<typeof manyProductSchema.shape> = {
  name: "products",
  primaryKey: [{
    name: "products",
    key: "id",
  }],
  relations: [
    {
      entityName: "categories",
      fields: ["categoryId"],
      type: ValueType.KEY,
    },
  ],
  // secondaryIndexes: [{
  //   key: [
  //     {
  //       name: "posts_by_userId",
  //       key: "userId",
  //     },
  //   ],
  //   valueType: ValueType.KEY,
  //   valueKey: "id",
  // }],
  schema: manyProductSchema,
};

const voteSchema = z.object({
  postId: z.string(),
  userLogin: z.string(),
  createdAt: z.date().optional(),
}).strict();
export const voteEntity: KVMEntity<typeof voteSchema.shape> = {
  name: "votes",
  primaryKey: [
    {
      name: "votes",
      key: "postId",
    },
    {
      key: "userLogin",
    },
  ],
  secondaryIndexes: [{
    name: "votes_by_user",
    key: [{
      key: "userLogin",
      name: "user",
    }, {
      key: "postId",
      name: "votes",
    }],
    valueType: ValueType.KEY,
    valueKey: "postId",
  }],
  schema: voteSchema,
};

const complexPostSchema = z.object({
  id: z.string(),
  userLogin: z.string(),
  slug: z.string(),
  title: z.string(),
  url: z.string(),
  content: z.string(),
  deleted: z.boolean().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export const complexPostEntity: KVMEntity<typeof complexPostSchema.shape> = {
  name: "complex_posts",
  primaryKey: [
    {
      name: "complex_posts",
      key: "id",
    },
  ],
  secondaryIndexes: [
    {
      name: "complex_posts_by_slug",
      key: [{
        name: "complex_posts_by_slug",
        key: "slug",
      }],
      valueKey: "id",
      valueType: ValueType.KEY,
    },
    {
      name: "user",
      key: [{
        name: "user",
        key: "userLogin",
      }, {
        name: "posts",
        key: "id",
      }],
      valueKey: "id",
      valueType: ValueType.KEY,
    },
  ],
  schema: complexPostSchema,
};

// ============================================================================
// Enhanced Relations Examples
// ============================================================================

// Author entity for enhanced relation examples
const authorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  bio: z.string().optional(),
}).strict();

export const authorEntity: KVMEntity<typeof authorSchema.shape> = {
  name: "authors",
  primaryKey: [{
    name: "authors",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "authors_by_email",
    key: [{
      name: "authors_by_email",
      key: "email",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
    unique: true,
  }],
  schema: authorSchema,
};

// Enhanced Post entity with belongsTo relation to Author
const enhancedPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  publishedAt: z.date().optional(),
}).strict();

export const enhancedPostEntity: KVMEntity<typeof enhancedPostSchema.shape> = {
  name: "enhanced_posts",
  primaryKey: [{
    name: "enhanced_posts",
    key: "id",
  }],
  relations: [{
    entityName: "authors",
    fields: ["authorId"],
    type: RelationType.BELONGS_TO,
    foreignKey: "authorId",
    valueType: ValueType.VALUE,
  }],
  secondaryIndexes: [{
    name: "enhanced_posts_by_author",
    key: [{
      name: "enhanced_posts_by_author",
      key: "authorId",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  schema: enhancedPostSchema,
};

// Tag entity for many-to-many relationship
const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
}).strict();

export const tagEntity: KVMEntity<typeof tagSchema.shape> = {
  name: "tags",
  primaryKey: [{
    name: "tags",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "tags_by_name",
    key: [{
      name: "tags_by_name",
      key: "name",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
    unique: true,
  }],
  schema: tagSchema,
};

// Post-Tag join table for many-to-many relationship
const postTagSchema = z.object({
  postId: z.string(),
  tagId: z.string(),
  createdAt: z.date().optional(),
}).strict();

export const postTagEntity: KVMEntity<typeof postTagSchema.shape> = {
  name: "post_tags",
  primaryKey: [
    {
      name: "post_tags",
      key: "postId",
    },
    {
      key: "tagId",
    },
  ],
  schema: postTagSchema,
};

// Enhanced Post entity with multiple relation types
const fullPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  publishedAt: z.date().optional(),
}).strict();

export const fullPostEntity: KVMEntity<typeof fullPostSchema.shape> = {
  name: "full_posts",
  primaryKey: [{
    name: "full_posts",
    key: "id",
  }],
  relations: [
    {
      // belongsTo relation - post belongs to an author
      entityName: "authors",
      fields: ["authorId"],
      type: RelationType.BELONGS_TO,
      foreignKey: "authorId",
      valueType: ValueType.VALUE,
    },
    {
      // hasMany relation - post has many comments
      entityName: "post_comments",
      fields: ["id"],
      type: RelationType.ONE_TO_MANY,
      foreignKey: "postId",
      valueType: ValueType.VALUE,
      cascade: true,
    },
    {
      // manyToMany relation - post has many tags through post_tags
      entityName: "tags",
      fields: ["id"],
      type: RelationType.MANY_TO_MANY,
      through: "post_tags",
      valueType: ValueType.VALUE,
    },
  ],
  secondaryIndexes: [{
    name: "full_posts_by_author",
    key: [{
      name: "full_posts_by_author",
      key: "authorId",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  schema: fullPostSchema,
};

// Enhanced Comment entity that belongs to both Post and User
const postCommentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  userId: z.string(),
  content: z.string(),
  createdAt: z.date().optional(),
}).strict();

export const postCommentEntity: KVMEntity<typeof postCommentSchema.shape> = {
  name: "post_comments",
  primaryKey: [{
    name: "post_comments",
    key: "id",
  }],
  relations: [
    {
      // belongsTo relation - comment belongs to a post
      entityName: "full_posts",
      fields: ["postId"],
      type: RelationType.BELONGS_TO,
      foreignKey: "postId",
      valueType: ValueType.VALUE,
    },
    {
      // belongsTo relation - comment belongs to a user
      entityName: "users",
      fields: ["userId"],
      type: RelationType.BELONGS_TO,
      foreignKey: "userId",
      valueType: ValueType.VALUE,
    },
  ],
  secondaryIndexes: [
    {
      name: "post_comments_by_post",
      key: [{
        name: "post_comments_by_post",
        key: "postId",
      }],
      valueType: ValueType.KEY,
      valueKey: "id",
    },
    {
      name: "post_comments_by_user",
      key: [{
        name: "post_comments_by_user",
        key: "userId",
      }],
      valueType: ValueType.KEY,
      valueKey: "id",
    },
  ],
  schema: postCommentSchema,
};

// Updated Author entity with hasMany relations
export const enhancedAuthorEntity: KVMEntity<typeof authorSchema.shape> = {
  name: "enhanced_authors",
  primaryKey: [{
    name: "enhanced_authors",
    key: "id",
  }],
  relations: [
    {
      // hasMany relation - author has many posts
      entityName: "full_posts",
      fields: ["id"],
      type: RelationType.ONE_TO_MANY,
      foreignKey: "authorId",
      valueType: ValueType.VALUE,
      cascade: true,
    },
  ],
  secondaryIndexes: [{
    name: "enhanced_authors_by_email",
    key: [{
      name: "enhanced_authors_by_email",
      key: "email",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
    unique: true,
  }],
  schema: authorSchema,
};

// ============================================================================
// TTL Examples
// ============================================================================

// Session entity for demonstrating TTL functionality
const sessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  token: z.string(),
  createdAt: z.date().optional(),
}).strict();

export const sessionEntity: KVMEntity<typeof sessionSchema.shape> = {
  name: "sessions",
  primaryKey: [{
    name: "sessions",
    key: "id",
  }],
  secondaryIndexes: [{
    name: "sessions_by_user",
    key: [{
      name: "sessions_by_user",
      key: "userId",
    }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  schema: sessionSchema,
};

// Cache entity for demonstrating TTL with caching patterns
const cacheSchema = z.object({
  key: z.string(),
  value: z.any(),
  createdAt: z.date().optional(),
}).strict();

export const cacheEntity: KVMEntity<typeof cacheSchema.shape> = {
  name: "cache",
  primaryKey: [{
    name: "cache",
    key: "key",
  }],
  schema: cacheSchema,
};
