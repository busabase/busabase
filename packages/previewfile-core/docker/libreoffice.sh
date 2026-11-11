#!/bin/sh
# LibreOffice for previewfile-core's Office → PDF conversion, set up the same
# way in every image that converts (Buda, Busabase Cloud, PreviewFile) so a
# document renders identically wherever it is previewed.
#
#   sh libreoffice.sh install [extra apt packages…]
#       As root: LibreOffice, CJK fonts and the en_US/zh_CN locales, plus any
#       other packages the image wants from the same apt run.
#   sh libreoffice.sh verify
#       As the runtime user: convert a file once — which also creates that
#       user's LibreOffice profile — so a broken install fails the build
#       instead of the first preview.
set -eu

case "${1:-}" in
  install)
    shift
    apt-get update
    apt-get install -y --no-install-recommends \
      locales \
      libreoffice \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      libreoffice-draw \
      fonts-liberation \
      fonts-dejavu-core \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fontconfig \
      "$@"
    sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen
    sed -i '/zh_CN.UTF-8/s/^# //g' /etc/locale.gen
    locale-gen
    apt-get clean
    rm -rf /var/lib/apt/lists/*
    ;;
  verify)
    dir=$(mktemp -d)
    echo "test" > "$dir/test.txt"
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 soffice --headless --invisible --nodefault --nolockcheck \
      --nologo --norestore --nofirststartwizard --convert-to pdf --outdir "$dir" "$dir/test.txt"
    ls -la "$dir/test.pdf"
    rm -rf "$dir"
    ;;
  *)
    echo "usage: $0 install [apt packages…] | verify" >&2
    exit 2
    ;;
esac
