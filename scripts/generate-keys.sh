#!/bin/sh
# Genera par de llaves RS256 para JWT si no existen
set -e

KEYS_DIR="${1:-./Cereza/Backend/keys}"
mkdir -p "$KEYS_DIR"

if [ -f "$KEYS_DIR/private.pem" ] && [ -f "$KEYS_DIR/public.pem" ]; then
    echo "[keys] ya existen: $KEYS_DIR/private.pem y public.pem"
    exit 0
fi

echo "[keys] generando par RS256 2048 bits..."
openssl genrsa -out "$KEYS_DIR/private.pem" 2048
openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem"
chmod 600 "$KEYS_DIR/private.pem"
chmod 644 "$KEYS_DIR/public.pem"

echo "[keys] generadas:"
echo "  - $KEYS_DIR/private.pem"
echo "  - $KEYS_DIR/public.pem"
