#!/bin/bash
# Script para instalar App Hitchi en otra PC con Linux Mint
# Ejecutar en la PC donde quedará la app 24/7

set -e

echo "========================================"
echo "  Instalación App Hitchi"
echo "========================================"

# 1. Instalar Node.js si no está
if ! command -v node &> /dev/null; then
  echo "Instalando Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
  sudo apt-get install -y nodejs
fi

echo "Node.js: $(node --version)"

# 2. Ir a la carpeta de la app
cd "$(dirname "$0")" || exit 1

# 3. Instalar dependencias
echo "Instalando dependencias..."
npm install

# 4. Preguntar por el correo
echo ""
echo "Configuración de correo electrónico:"
read -p "EMAIL_USER (correo Gmail): " EMAIL_USER
read -sp "EMAIL_PASS (contraseña de aplicación): " EMAIL_PASS
echo ""

# 5. Iniciar servidor
echo ""
echo "Iniciando servidor..."
kill $(lsof -t -i:3000) 2>/dev/null || true
EMAIL_USER="$EMAIL_USER" EMAIL_PASS="$EMAIL_PASS" setsid node server.js > /tmp/hitchi-server.log 2>&1 &

sleep 2
if curl -s -o /dev/null http://localhost:3000; then
  echo "✅ Servidor corriendo en: http://localhost:3000"
  echo ""
  echo "========================================"
  echo "  PARA HACERLA ACCESIBLE DESDE CELULAR:"
  echo "========================================"
  echo "Ejecuta en OTRA terminal:"
  echo "  /tmp/cloudflared tunnel --url http://localhost:3000"
  echo ""
  echo "o descarga cloudflared con:"
  echo '  curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared'
  echo "  chmod +x /tmp/cloudflared"
  echo "  /tmp/cloudflared tunnel --url http://localhost:3000"
  echo ""
  echo "Aparecerá una URL como:"
  echo "  https://xxxx.trycloudflare.com"
  echo "Esa es la URL para los técnicos."
  echo "========================================"
else
  echo "❌ Error al iniciar servidor. Revisa: cat /tmp/hitchi-server.log"
fi
