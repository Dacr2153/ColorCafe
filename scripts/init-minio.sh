#!/bin/sh
# Inicializa MinIO: crea buckets y políticas de lifecycle
set -e

MC_ALIAS=local
MINIO_URL=http://minio:9000

echo "[init-minio] esperando MinIO..."
until mc alias set "$MC_ALIAS" "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" 2>/dev/null; do
    sleep 1
done
echo "[init-minio] conectado"

for BUCKET in cafe-analyses cafe-documents cafe-marketplace; do
    if ! mc ls "$MC_ALIAS/$BUCKET" >/dev/null 2>&1; then
        mc mb "$MC_ALIAS/$BUCKET"
        echo "[init-minio] creado $BUCKET"
    else
        echo "[init-minio] $BUCKET ya existe"
    fi
done

# Lifecycle: pasar a tier reducido tras 90 días (solo si el cliente lo soporta)
cat > /tmp/lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "archive-old-analyses",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "Expiration": { "Days": 730 }
    }
  ]
}
EOF
mc ilm import "$MC_ALIAS/cafe-analyses" < /tmp/lifecycle.json 2>/dev/null || true

echo "[init-minio] listo"
