#!/bin/sh
set -eu

data_dir=/var/www/html/webtrees/data

mkdir -p "$data_dir"

# Docker creates a missing bind-mount directory as root.  Make a new/empty
# data directory writable by Apache/PHP without changing the application files.
if [ "$(id -u)" = "0" ]; then
    chown www-data:www-data "$data_dir"
fi

exec docker-php-entrypoint "$@"

