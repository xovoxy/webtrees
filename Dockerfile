FROM node:22-bookworm-slim AS frontend

WORKDIR /src

COPY package.json package-lock.json webpack.config.js ./
RUN npm ci

COPY resources ./resources
COPY public ./public

RUN npm run build


FROM php:8.3-apache-bookworm AS php-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libcurl4-openssl-dev \
        libfreetype6-dev \
        libicu-dev \
        libjpeg62-turbo-dev \
        libonig-dev \
        libpng-dev \
        libsqlite3-dev \
        libxml2-dev \
        libzip-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" \
        curl \
        exif \
        gd \
        intl \
        mbstring \
        opcache \
        pdo_sqlite \
        xml \
        zip \
    && a2enmod expires headers rewrite \
    && rm -rf /var/lib/apt/lists/*

COPY docker/apache-webtrees.conf /etc/apache2/conf-available/webtrees.conf
COPY docker/php-webtrees.ini /usr/local/etc/php/conf.d/webtrees.ini
COPY docker/webtrees-entrypoint.sh /usr/local/bin/webtrees-entrypoint

RUN a2enconf webtrees \
    && chmod 0755 /usr/local/bin/webtrees-entrypoint


FROM php-base AS backend

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

WORKDIR /var/www/html/webtrees

COPY composer.json composer.lock ./

RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --prefer-dist \
    --optimize-autoloader


FROM php-base AS runtime

WORKDIR /var/www/html/webtrees

COPY . ./
COPY --from=backend /var/www/html/webtrees/vendor ./vendor
COPY --from=frontend /src/public ./public

RUN mkdir -p data \
    && chown -R www-data:www-data data

VOLUME ["/var/www/html/webtrees/data"]

EXPOSE 80

ENTRYPOINT ["webtrees-entrypoint"]
CMD ["apache2-foreground"]
