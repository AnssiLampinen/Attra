import argparse
import os
import sqlite3


DEFAULT_DB_PATH = "crm.db"


def _get_user_tables(cursor: sqlite3.Cursor) -> list[str]:
    rows = cursor.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    ).fetchall()
    return [row[0] for row in rows]


def clear_all_entries(db_path: str) -> int:
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        tables = _get_user_tables(cursor)

        for table in tables:
            cursor.execute(f'DELETE FROM "{table}"')

        # Reset AUTOINCREMENT counters when present.
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
        )
        if cursor.fetchone() is not None:
            cursor.execute("DELETE FROM sqlite_sequence")

        conn.commit()
        return len(tables)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clear all rows from all user tables in a SQLite database."
    )
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="Path to SQLite database file.")
    args = parser.parse_args()

    db_path = args.db
    if not os.path.exists(db_path):
        raise SystemExit(f"Database file not found: {os.path.abspath(db_path)}")

    table_count = clear_all_entries(db_path)
    print(f"Cleared all entries from {table_count} table(s) in {os.path.abspath(db_path)}")


if __name__ == "__main__":
    main()
