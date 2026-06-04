import Database from 'better-sqlite3';
import fs from 'fs';
const db = new Database('./data.db', { readonly: true });
const tables = ['categories','areas','tradesmen','jobs','quotes','reviews','credit_transactions','tradesman_credits'];
const out = {};
for (const t of tables) {
  out[t] = db.prepare(`SELECT * FROM ${t}`).all();
}
fs.writeFileSync('/tmp/db_dump.json', JSON.stringify(out));
for (const t of tables) console.log(`${t}: ${out[t].length} rows`);
