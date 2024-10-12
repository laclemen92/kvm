import { ValueType } from "./types.ts";
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
