#!/usr/bin/env bash
# Publie verif/ sur la branche de la sonde (plusieurs tâches en parallèle : on rejoue sur la dernière version).
set +e
git config user.name 'sonde'
git config user.email 'sonde@users.noreply.github.com'
git add -f verif
git commit -qm "Résultats de la sonde n°17 ($1)" || { echo "rien à publier"; exit 0; }
for i in 1 2 3 4 5; do
  git pull -q --rebase origin data-probe-2 && git push -q origin HEAD:data-probe-2 && exit 0
  sleep $((i * 5))
done
echo "publication impossible"
