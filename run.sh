#!/bin/bash
# Save command-line PORT if specified
ENV_PORT=$PORT

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Restore command-line PORT if it was passed
if [ -n "$ENV_PORT" ]; then
  PORT=$ENV_PORT
fi

PORT=${PORT:-8010} \
DB_HOST=${DB_HOST:-localhost} \
DB_PORT=${DB_PORT:-5432} \
DB_USER=${DB_USER:-system} \
DB_PASSWORD=${DB_PASSWORD:-manager} \
DB_NAME=${DB_NAME:-context75} \
npm run dev --prefix server
