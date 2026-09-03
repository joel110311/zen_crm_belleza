import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/tenant-migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
