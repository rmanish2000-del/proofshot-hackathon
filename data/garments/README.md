# Garment intake

One folder per garment: `shirt-01/`, `shirt-02/`, `shirt-03/`. Each holds:

- `1-front.jpg`, `2-back.jpg`, `3-collar.jpg`, `4-print.jpg`: phone photos of
  the garment alone, laid flat or on a hanger. **No person in any photo.**
- `intake.json`: written by `npm run intake`, never by hand. For every photo it
  lists the name it arrived with, the sha256 of the bytes as they arrived
  (`source_sha256`), the sha256 of the stored file (`sha256`, the hash a receipt's
  `source_images` carries) and the metadata segments removed.
- `note.txt`: the garment note the renderer is given. Filled in by a person.
- `WHY.txt`: why this garment is in the demo and who allowed it. Filled in by a person.

To add photos, put them in a folder outside this repo, one subfolder per
garment, and run:

```
npm run intake -- <that folder>
```

Intake removes Exif (GPS, device, time), XMP, IPTC and comments without
re-encoding, so the pixels do not change. It keeps the ICC colour profile. A
test fails if any committed photo still carries metadata, or does not match
its `intake.json`.

These photos are the real demo input. Tests use synthetic images only.
