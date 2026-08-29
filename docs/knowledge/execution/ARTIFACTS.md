# ARTIFACTS — Sovereign Knowledge Core V1

> Catalogue des artefacts locaux (binaires, bundles, fixtures, hash
> report). Pour chaque artefact : path, type, taille, SHA-256, timestamp,
> commande émettrice, statut.

| # | Path | Type | Taille | SHA-256 | Timestamp | Commande | Statut |
|---|---|---|---|---|---|---|---|
| 000 | _à venir_ | | | | | | |

## Convention de hash

SHA-256 calculé par :

```powershell
Get-FileHash -Path <path> -Algorithm SHA256 | Select-Object -ExpandProperty Hash
```

## Convention de timestamp

ISO-8601 UTC, capturé par `Get-Date -AsUTC -Format "o"`.
