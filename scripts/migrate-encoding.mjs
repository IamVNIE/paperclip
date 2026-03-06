#!/usr/bin/env node
/**
 * Migrates the embedded PostgreSQL database from WIN1252 to UTF-8 encoding.
 *
 * Steps:
 * 1. Connect to the existing database and dump all user table data as JSON
 * 2. Stop the server (user must do this manually)
 * 3. Delete the data directory
 * 4. Let the server reinitialize with UTF-8 on next start
 * 5. Restore the data
 *
 * Usage:
 *   node scripts/migrate-encoding.mjs dump    # Step 1: dump data while server is running
 *   node scripts/migrate-encoding.mjs restore # Step 2: restore data after server reinitializes
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Resolve 'postgres' from the @paperclipai/db package context
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPkgDir = resolve(__dirname, "..", "packages", "db");
const require = createRequire(resolve(dbPkgDir, "package.json"));
const postgres = require("postgres");

const DUMP_FILE = resolve(__dirname, "..", "encoding-migration-dump.json");
const CONNECTION_STRING = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function dump() {
  console.log("Connecting to embedded PostgreSQL...");
  const sql = postgres(CONNECTION_STRING, { max: 1 });

  try {
    // Get all user tables (exclude system tables)
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    console.log(`Found ${tables.length} tables`);

    const dump = {};

    // Determine foreign key dependency order for restore
    const fkDeps = await sql`
      SELECT
        tc.table_name AS child,
        ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `;

    // Build a dependency graph and topologically sort
    const tableSet = new Set(tables.map((t) => t.table_name));
    const deps = {};
    for (const t of tableSet) deps[t] = new Set();
    for (const fk of fkDeps) {
      if (tableSet.has(fk.child) && tableSet.has(fk.parent) && fk.child !== fk.parent) {
        deps[fk.child].add(fk.parent);
      }
    }

    // Topological sort (Kahn's algorithm)
    const inDegree = {};
    for (const t of tableSet) inDegree[t] = 0;
    for (const [child, parents] of Object.entries(deps)) {
      inDegree[child] = parents.size;
    }
    const queue = Object.keys(inDegree).filter((t) => inDegree[t] === 0);
    const sortedTables = [];
    while (queue.length > 0) {
      const t = queue.shift();
      sortedTables.push(t);
      for (const [child, parents] of Object.entries(deps)) {
        if (parents.has(t)) {
          parents.delete(t);
          inDegree[child]--;
          if (inDegree[child] === 0) queue.push(child);
        }
      }
    }
    // Add any remaining (circular deps) at the end
    for (const t of tableSet) {
      if (!sortedTables.includes(t)) sortedTables.push(t);
    }

    for (const tableName of sortedTables) {
      // Use text mode to avoid encoding issues during dump - convert problematic chars
      const rows = await sql.unsafe(
        `SELECT * FROM "${tableName}"`,
      );
      dump[tableName] = rows;
      console.log(`  ${tableName}: ${rows.length} rows`);
    }

    // Store the table order for restore
    dump.__table_order__ = sortedTables;

    await writeFile(DUMP_FILE, JSON.stringify(dump, null, 2), "utf8");
    console.log(`\nDump saved to: ${DUMP_FILE}`);
    console.log("\nNext steps:");
    console.log("  1. Stop the dev server (Ctrl+C)");
    console.log("  2. Delete the data directory:");
    console.log('     rm -rf "$HOME/.paperclip/instances/default/db"');
    console.log("  3. Start the dev server: pnpm dev");
    console.log("     (wait for it to initialize and apply migrations)");
    console.log("  4. Run: node scripts/migrate-encoding.mjs restore");
  } finally {
    await sql.end();
  }
}

async function restore() {
  console.log("Reading dump file...");
  const raw = await readFile(DUMP_FILE, "utf8");
  const dump = JSON.parse(raw);
  const tableOrder = dump.__table_order__;
  if (!tableOrder) {
    console.error("ERROR: Dump file missing __table_order__. Was it created by this script?");
    process.exit(1);
  }

  console.log("Connecting to embedded PostgreSQL...");
  const sql = postgres(CONNECTION_STRING, { max: 1 });

  try {
    // Verify encoding is now UTF8
    const encoding = await sql`SHOW server_encoding`;
    console.log(`Server encoding: ${encoding[0].server_encoding}`);
    const dbEncoding = await sql`
      SELECT pg_encoding_to_char(encoding) as enc FROM pg_database WHERE datname = 'paperclip'
    `;
    console.log(`Database encoding: ${dbEncoding[0].enc}`);

    if (dbEncoding[0].enc !== "UTF8") {
      console.error("ERROR: Database is not UTF8. Did you delete the data dir and reinitialize?");
      process.exit(1);
    }

    // Disable FK constraints temporarily
    await sql`SET session_replication_role = 'replica'`;

    for (const tableName of tableOrder) {
      const rows = dump[tableName];
      if (!rows || rows.length === 0) {
        console.log(`  ${tableName}: 0 rows (skipping)`);
        continue;
      }

      // Clear existing data (migrations may have seeded some)
      await sql.unsafe(`DELETE FROM "${tableName}"`);

      // Insert in batches
      const batchSize = 100;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const columns = Object.keys(batch[0]);
        const colList = columns.map((c) => `"${c}"`).join(", ");
        const values = batch
          .map((row, rowIdx) => {
            const offset = rowIdx * columns.length;
            return `(${columns.map((_, ci) => `$${offset + ci + 1}`).join(", ")})`;
          })
          .join(", ");
        const params = batch.flatMap((row) => columns.map((c) => row[c]));

        await sql.unsafe(
          `INSERT INTO "${tableName}" (${colList}) VALUES ${values}`,
          params,
        );
        inserted += batch.length;
      }
      console.log(`  ${tableName}: ${inserted} rows restored`);
    }

    // Re-enable FK constraints
    await sql`SET session_replication_role = 'origin'`;

    // Reset sequences to max ID values
    const sequences = await sql`
      SELECT
        s.relname AS seq_name,
        t.relname AS table_name,
        a.attname AS column_name
      FROM pg_class s
      JOIN pg_depend d ON d.objid = s.oid
      JOIN pg_class t ON d.refobjid = t.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE s.relkind = 'S'
    `;

    for (const seq of sequences) {
      try {
        const maxVal = await sql.unsafe(
          `SELECT COALESCE(MAX("${seq.column_name}"), 0) + 1 AS next_val FROM "${seq.table_name}"`,
        );
        if (maxVal[0].next_val > 0) {
          await sql.unsafe(`ALTER SEQUENCE "${seq.seq_name}" RESTART WITH ${maxVal[0].next_val}`);
        }
      } catch {
        // Skip if column doesn't exist or is not numeric
      }
    }

    console.log("\nRestore complete!");
    console.log("You can delete the dump file: rm encoding-migration-dump.json");
  } finally {
    await sql.end();
  }
}

const command = process.argv[2];
if (command === "dump") {
  dump().catch((err) => {
    console.error("Dump failed:", err);
    process.exit(1);
  });
} else if (command === "restore") {
  restore().catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  });
} else {
  console.log("Usage: node scripts/migrate-encoding.mjs <dump|restore>");
  console.log("");
  console.log("  dump    - Export all data from the running database");
  console.log("  restore - Import data into a fresh UTF-8 database");
  process.exit(1);
}
