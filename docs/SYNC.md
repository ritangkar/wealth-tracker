# Cross-device use

IndexedDB + GitHub Pages cannot synchronise devices by themselves. We do not pretend otherwise.

## What works today (no service, fully offline)
1. **Backup & move**: Settings → Download backup → open the app on the other device → Restore from file.
2. **Merge**: choose *Merge* when restoring. Records are matched by `id`; the newer `updatedAt` wins; deletions (tombstones) apply when newer than the record; the merged result is fully re-validated and a safety snapshot of the current data is taken first. Two people can each use their own device and merge periodically (e.g. weekly).
   Limits: concurrent edits to the *same record* resolve to the newer one (no field-level merge); account/transaction deletions that leave dangling references abort the merge with a clear message rather than corrupting data.

## Evaluated options (none mandatory, none built)
| Option | Free | Private | Verdict |
|---|---|---|---|
| Manual JSON + merge (built) | yes | yes | Default. |
| File System Access API to a folder synced by the user's own Drive/iCloud/Syncthing | yes | yes (user's cloud) | Chromium desktop only; good optional adapter later: write an encrypted backup file on change, read newer on open. |
| Private GitHub repo as store via fine-grained token | yes | encrypted blob only | Needs a token stored locally; feasible optional adapter (encrypt client-side with a passphrase before commit). |
| WebRTC peer-to-peer | yes | yes | Needs both devices online + signalling; complex. |
| Firebase/Supabase | free tiers | data leaves device | Rejected as default; violates privacy-first. |

## Design hooks already in place
`Storage` port; stable ids; `createdAt/updatedAt`; tombstones; `mergeDatabases`; versioned+migratable backups; checksum. A sync adapter = "serialise → encrypt → put/get → `store.restore(…, 'merge')`".
