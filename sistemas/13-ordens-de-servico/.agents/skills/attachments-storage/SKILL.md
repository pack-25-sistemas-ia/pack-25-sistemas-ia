---
name: attachments-storage
description: Use ao mexer em upload, fotos, PDF anexado, logotipo ou Storage.
---

# attachments-storage

- Tipo pelos **bytes** (JPEG/PNG/WebP/PDF); recusar SVG/HTML. Fotos têm EXIF/XMP/IPTC/comentários removidos (mantém orientação) por `lib/os/attachments.ts`; malformado é recusado.
- Caminho gerado no servidor: `<empresa>/<ordem>/<32hex>.<ext>`; o banco confere o padrão (`os_add_attachments`). Bucket `os-files` privado; `os-logos` público.
- Download por URL assinada curta, `nosniff`, nome sanitizado. Sem antivírus: não afirmar o contrário.
