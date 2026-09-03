import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/control-plane/schema.prisma",
  migrations: {
    path: "prisma/control-plane/migrations",
  },
  datasource: {
    url: process.env["CONTROL_DATABASE_URL"],
  },
});
