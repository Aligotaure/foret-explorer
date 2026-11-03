#!/usr/bin/env bash
# Tailles d'un dossier de tuiles par niveau de zoom.
d=$1
echo "total : $(find "$d" -name '*.pbf' | wc -l) tuiles, $(du -sh "$d" | cut -f1)"
for z in $(ls "$d" | grep -E '^[0-9]+$' | sort -n); do
  n=$(find "$d/$z" -name '*.pbf' | wc -l)
  s=$(du -sh "$d/$z" | cut -f1)
  max=$(find "$d/$z" -name '*.pbf' -printf '%s\n' | sort -n | tail -1)
  med=$(find "$d/$z" -name '*.pbf' -printf '%s\n' | sort -n | awk '{a[NR]=$1} END {print a[int(NR/2)+1]}')
  echo "  z$z : $n tuiles, $s, médiane $med octets, plus grosse $max octets"
done
