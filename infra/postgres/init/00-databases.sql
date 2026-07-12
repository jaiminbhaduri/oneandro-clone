-- docker-entrypoint-initdb.d runs *.sql files in lexical order, once, only
-- on an empty data directory. This provisions one logical database per
-- service (schema-per-service isolation, shared instance for local dev).
SELECT 'CREATE DATABASE users_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'users_db')\gexec
SELECT 'CREATE DATABASE leads_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'leads_db')\gexec
SELECT 'CREATE DATABASE ai_db'    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_db')\gexec

GRANT ALL PRIVILEGES ON DATABASE users_db TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE leads_db TO CURRENT_USER;
GRANT ALL PRIVILEGES ON DATABASE ai_db    TO CURRENT_USER;
