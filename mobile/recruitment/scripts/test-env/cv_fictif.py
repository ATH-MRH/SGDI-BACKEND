import base64, sys
lines = [('F2', 22, 'BENSALEM Amine'), ('F1', 12, 'Agent de securite - Alger (donnees fictives de test)'), ('F1', 11, ''),
         ('F2', 13, 'Experience'), ('F1', 11, '2022-2026  Agent de securite, site industriel, Rouiba'), ('F1', 11, '2019-2022  Agent d accueil, centre commercial, Alger'), ('F1', 11, ''),
         ('F2', 13, 'Formation'), ('F1', 11, 'Attestation de formation agent de securite (2019)'), ('F1', 11, ''),
         ('F2', 13, 'Langues'), ('F1', 11, 'Arabe, francais')]
y, ops = 780, []
for font, size, text in lines:
    ops.append(f'BT /{font} {size} Tf 60 {y} Td ({text}) Tj ET'); y -= size + 10
stream = '\n'.join(ops).encode('latin-1')
objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
        b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']
out, offsets = b'%PDF-1.4\n', []
for i, o in enumerate(objs, 1):
    offsets.append(len(out)); out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
xref = len(out)
out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)
target = sys.argv[1] if len(sys.argv) > 1 else '.'
open(target + '/cv-fictif.pdf', 'wb').write(out); open(target + '/cv-fictif.b64', 'w').write(base64.b64encode(out).decode())
