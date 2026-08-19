/**
 * Cloudflare Worker: Dynamic Open Graph meta tags for "ทางตรง มอเตอร์"
 * -------------------------------------------------------------------
 * เมื่อมีคนแชร์ลิงก์แบบ https://car.unjaiit.com/?car=xxxxx ไปที่ LINE, Facebook,
 * Twitter/X ฯลฯ Worker นี้จะดึงข้อมูลรถคันนั้นจาก Firestore มาแทรกลงใน
 * <title>, og:title, og:description, og:image ฯลฯ ก่อนส่ง HTML กลับไป
 * ทำให้พรีวิวที่ขึ้นในแชทแสดงรูป/ชื่อ/ราคาของรถคันนั้นจริงๆ
 *
 * ถ้าไม่มี ?car= ในลิงก์ หรือหารถไม่เจอ (ถูกลบ/ขายไปแล้ว) จะปล่อยผ่านไปใช้
 * meta tag ปกติของหน้าเว็บ (ข้อมูลร้านทั่วไป) โดยไม่ error
 */

const FIRESTORE_PROJECT_ID = "carvip-55c82"; // เปลี่ยนถ้าคุณย้าย Firebase project
const SITE_NAME = "ทางตรง มอเตอร์";
const DEFAULT_OG_IMAGE = "https://car.unjaiit.com/brand-assets/og-default-1200x630.png";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const carId = url.searchParams.get("car");

    // ดึงหน้าเว็บต้นฉบับจาก origin (GitHub Pages) เสมอ
    const originResponse = await fetch(request);

    // ถ้าไม่ได้แชร์ลิงก์เจาะจงรถคันไหน หรือ response ไม่ใช่ HTML ก็ไม่ต้องแทรกอะไร
    const contentType = originResponse.headers.get("content-type") || "";
    if (!carId || !contentType.includes("text/html")) {
      return originResponse;
    }

    let car = null;
    try {
      car = await fetchCarFromFirestore(carId);
    } catch (e) {
      // Firestore ดึงไม่สำเร็จ (network/format ผิดพลาด) -> ปล่อยผ่านใช้ meta เดิม
      return originResponse;
    }

    // หารถไม่เจอ (ถูกลบ/ขายแล้ว) -> ปล่อยผ่าน ให้หน้าเว็บจัดการ redirect ไปหน้าหลักเอง (ฝั่ง client JS)
    if (!car) {
      return originResponse;
    }

    const price = car.price ? Number(car.price).toLocaleString("en-US") : null;
    const mileage = car.mileage ? Number(car.mileage).toLocaleString("en-US") : null;
    const statusLabel = car.status === "sold" ? " (ขายแล้ว)" : "";

    const title = `${car.brand || ""} ${car.model || ""} ปี ${car.year || ""}${statusLabel} | ${SITE_NAME}`;
    const descParts = [];
    if (price) descParts.push(`ราคา ${price} บาท`);
    if (mileage) descParts.push(`เลขไมล์ ${mileage} กม.`);
    if (car.transmission) descParts.push(car.transmission === "auto" ? "เกียร์อัตโนมัติ" : "เกียร์ธรรมดา");
    const description = descParts.length ? descParts.join(" · ") : `ดูรายละเอียด ${car.brand} ${car.model} ที่ ${SITE_NAME}`;

    const image = (car.images && car.images.length > 0) ? car.images[0] : DEFAULT_OG_IMAGE;
    const pageUrl = url.toString();

    const rewriter = new HTMLRewriter()
      .on("title", { element(el) { el.setInnerContent(title); } })
      .on('meta[name="description"]', { element(el) { el.setAttribute("content", description); } })
      .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", title); } })
      .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", description); } })
      .on('meta[property="og:image"]', { element(el) { el.setAttribute("content", image); } })
      .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", pageUrl); } })
      .on('meta[name="twitter:image"]', { element(el) { el.setAttribute("content", image); } })
      .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", pageUrl); } });

    return rewriter.transform(originResponse);
  },
};

// ---------- Firestore REST helpers ----------
async function fetchCarFromFirestore(carId) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/cars/${carId}`;
  const res = await fetch(endpoint);
  if (res.status === 404) return null; // ถูกลบ/ไม่มีอยู่จริง
  if (!res.ok) throw new Error(`Firestore error: ${res.status}`);
  const data = await res.json();
  if (!data.fields) return null;
  return parseFirestoreFields(data.fields);
}

function parseFirestoreValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if (v.mapValue !== undefined) return parseFirestoreFields(v.mapValue.fields || {});
  return null;
}

function parseFirestoreFields(fields) {
  const out = {};
  for (const key in fields) out[key] = parseFirestoreValue(fields[key]);
  return out;
}
