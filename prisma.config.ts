/*
 * @Description: 
 * @Version: 1.0
 * @Autor: Xuelong Ba
 * @Date: 2025-11-09 15:27:43
 * @LastEditors: Xuelong Ba
 * @LastEditTime: 2025-11-09 15:33:33
 */
import { defineConfig } from "prisma/config";
import "dotenv/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    // Permit npm ci / Prisma client generation before the independent installer
    // creates .env. Database commands still fail without valid credentials.
    url: process.env.DATABASE_URL || "mysql://unconfigured@127.0.0.1:3306/poleis_unconfigured",
  },
});
