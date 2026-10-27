// رمز QR بيتولّد محليًا في المتصفح (مكتبة qrcode) — بيانات الفاتورة والتوقيع الرقمي ما بتخرجش لأي خدمة خارجية.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrImage({ data, size = 110, className }: { data: string; size?: number; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(data, { width: size * 2, margin: 0, errorCorrectionLevel: 'M' }).then((u) => { if (alive) setSrc(u); }, () => setSrc(''));
    return () => { alive = false; };
  }, [data, size]);
  return src ? <img className={className} src={src} alt="QR" width={size} height={size} /> : null;
}
