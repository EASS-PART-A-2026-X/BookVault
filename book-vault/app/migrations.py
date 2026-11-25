"""Tiny, explicit schema migrations for SQLite databases made by older versions.

`Base.metadata.create_all` creates missing *tables* but never changes existing ones.
Each step here checks the live schema first, so it is safe to run on every start
(new databases already have everything and are left alone).
"""

from sqlalchemy import Engine, inspect, text


def migrate(engine: Engine) -> list[str]:
    """Apply any missing steps; return the names of the steps applied."""
    applied: list[str] = []
    columns = {c["name"] for c in inspect(engine).get_columns("books")}

    # v0.3 (accounts): books belong to a user. Existing books keep owner_id NULL until
    # the first account registers and adopts them (see app/auth.py: register).
    if "owner_id" not in columns:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE books ADD COLUMN owner_id INTEGER "
                    "REFERENCES users(id) ON DELETE CASCADE"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_books_owner_id ON books (owner_id)"))
        applied.append("books.owner_id")

    # v0.5 (password reset): users have an optional, unique, private email.
    user_columns = {c["name"] for c in inspect(engine).get_columns("users")}
    if "email" not in user_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(254)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
        applied.append("users.email")

    return applied
