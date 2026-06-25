"use server";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/session";

export async function login(state: { error?: string } | undefined, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) return { error: "Email ve şifre gereklidir." };

  const user = await db.user.findUnique({ where: { email } });
  if (!user) return { error: "Geçersiz email veya şifre." };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return { error: "Geçersiz email veya şifre." };

  await createSession(user.id);
  redirect("/admin/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/admin/login");
}
