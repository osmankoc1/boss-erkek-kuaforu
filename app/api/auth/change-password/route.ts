import bcrypt from "bcryptjs";
import { getSession, deleteSession } from "@/lib/session";
import { db } from "@/lib/db";

function validateStrength(password: string): string | null {
  if (password.length < 8) return "Şifre en az 8 karakter olmalıdır.";
  if (!/[A-Z]/.test(password)) return "En az bir büyük harf gereklidir.";
  if (!/[a-z]/.test(password)) return "En az bir küçük harf gereklidir.";
  if (!/[0-9]/.test(password)) return "En az bir rakam gereklidir.";
  if (!/[^A-Za-z0-9]/.test(password)) return "En az bir özel karakter gereklidir (!@#$%...).";
  return null;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.userId) {
    return Response.json({ error: "Yetkisiz." }, { status: 401 });
  }

  const body = await req.json();
  const { currentPassword, newPassword, confirmPassword } = body ?? {};

  if (!currentPassword || !newPassword || !confirmPassword) {
    return Response.json({ error: "Tüm alanlar zorunludur." }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return Response.json({ error: "Yeni şifreler eşleşmiyor." }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return Response.json({ error: "Yeni şifre mevcut şifreyle aynı olamaz." }, { status: 400 });
  }

  const strengthError = validateStrength(newPassword);
  if (strengthError) {
    return Response.json({ error: strengthError }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    return Response.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return Response.json({ error: "Mevcut şifre yanlış." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.user.update({ where: { id: session.userId }, data: { passwordHash } });
  await deleteSession();

  return Response.json({ ok: true });
}
