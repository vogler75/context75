#!/bin/bash
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DB_HOST=${DB_HOST:-localhost} \
DB_PORT=${DB_PORT:-5432} \
DB_USER=${DB_USER:-system} \
DB_PASSWORD=${DB_PASSWORD:-manager} \
DB_NAME=${DB_NAME:-context75} \
npm run dev --prefix server > server/server.log 2>&1 &
