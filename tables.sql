CREATE TABLE IF NOT EXISTS agents (
    uuid VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(10),
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    sleep INT,
    profile VARCHAR(100),
    ip VARCHAR(64),
    hostname VARCHAR(255)
);

GRANT ALL PRIVILEGES ON yggdrasil.* TO 'yggdrasil'@'%' IDENTIFIED BY '6UvuUQoagtavA2zWn0MrgPpRxj5h8LB1';
FLUSH PRIVILEGES;
