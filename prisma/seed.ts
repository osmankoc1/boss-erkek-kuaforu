import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import bcrypt from "bcryptjs";

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // Admin kullanıcı
  const passwordHash = await bcrypt.hash("boss2024", 12);
  await db.user.upsert({
    where: { email: "admin@boss.com" },
    update: {},
    create: { email: "admin@boss.com", passwordHash, name: "Admin" },
  });

  // İşletme ayarları
  const defaultSettings = [
    { key: "business_name", value: "BOSS Erkek Kuaförü" },
    { key: "business_phone", value: "+90 555 000 00 00" },
    { key: "business_email", value: "info@boss-kuafor.com" },
    { key: "business_address", value: "Bağcılar, İstanbul, Türkiye" },
    { key: "maps_link", value: "" },
    { key: "resend_from_email", value: "randevu@boss-kuafor.com" },
    { key: "google_calendar_enabled", value: "false" },
  ];
  for (const s of defaultSettings) {
    await db.setting.upsert({ where: { key: s.key }, update: {}, create: s });
  }

  // Berberler
  const barber1 = await db.barber.upsert({
    where: { id: "barber-1" },
    update: {},
    create: {
      id: "barber-1",
      name: "Mehmet Usta",
      bio: "15 yıllık deneyimiyle klasik ve modern erkek saç kesimlerinde uzman.",
      specialty: "Klasik Saç Kesimi",
      experienceYrs: 15,
      calendarColor: "#c9762c",
    },
  });

  const barber2 = await db.barber.upsert({
    where: { id: "barber-2" },
    update: {},
    create: {
      id: "barber-2",
      name: "Ahmet Demir",
      bio: "Modern fade ve sakal şekillendirme konusunda uzmanlaşmış genç berber.",
      specialty: "Modern Fade & Sakal",
      experienceYrs: 7,
      calendarColor: "#e8913a",
    },
  });

  // Hizmetler
  const services = [
    { id: "svc-1", name: "Saç Kesimi", description: "Klasik veya modern saç kesimi", durationMinutes: 30, price: 150 },
    { id: "svc-2", name: "Sakal Kesimi", description: "Sakal şekillendirme ve düzeltme", durationMinutes: 20, price: 100 },
    { id: "svc-3", name: "Saç + Sakal", description: "Komple bakım paketi", durationMinutes: 50, price: 220 },
    { id: "svc-4", name: "Fade Saç Kesimi", description: "Modern fade tekniği", durationMinutes: 45, price: 200 },
    { id: "svc-5", name: "Çocuk Saç Kesimi", description: "12 yaş altı", durationMinutes: 25, price: 100 },
    { id: "svc-6", name: "Saç Bakımı", description: "Derin nem + bakım maskesi", durationMinutes: 40, price: 180 },
  ];
  for (const s of services) {
    await db.service.upsert({ where: { id: s.id }, update: {}, create: s });
  }

  // Çalışma saatleri (Pzt-Cmt 09:00-19:00, Pazar kapalı)
  for (const barber of [barber1, barber2]) {
    for (let day = 0; day <= 6; day++) {
      await db.workingHour.upsert({
        where: { id: `wh-${barber.id}-${day}` },
        update: {},
        create: {
          id: `wh-${barber.id}-${day}`,
          barberId: barber.id,
          dayOfWeek: day,
          startTime: "09:00",
          endTime: "19:00",
          isOff: day === 0,
        },
      });
    }
  }

  // Örnek kampanya
  await db.campaign.upsert({
    where: { id: "camp-1" },
    update: {
      buttonText: "Hemen Randevu Al",
      buttonLink: "/randevu",
      priority: 0,
    },
    create: {
      id: "camp-1",
      title: "Haziran Özel — %20 İndirim",
      description: "Saç + Sakal paketinde Haziran ayı boyunca %20 indirim fırsatı!",
      buttonText: "Hemen Randevu Al",
      buttonLink: "/randevu",
      priority: 0,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-30"),
      isActive: true,
      showOnHome: true,
    },
  });

  // Örnek müşteriler
  const customers = [
    { id: "cust-1", fullName: "Ali Kaya", phone: "+90 530 111 2233" },
    { id: "cust-2", fullName: "Burak Şahin", phone: "+90 530 222 3344" },
    { id: "cust-3", fullName: "Can Yıldız", phone: "+90 530 333 4455" },
    { id: "cust-4", fullName: "Deniz Arslan", phone: "+90 530 444 5566" },
    { id: "cust-5", fullName: "Emre Çelik", phone: "+90 530 555 6677" },
    { id: "cust-6", fullName: "Fatih Demir", phone: "+90 530 666 7788" },
    { id: "cust-7", fullName: "Gökhan Koç", phone: "+90 530 777 8899" },
  ];
  for (const c of customers) {
    await db.customer.upsert({ where: { id: c.id }, update: {}, create: c });
  }

  // Örnek randevular (son 30 gün + bugün/yarın)
  const svcPrices: Record<string, number> = {
    "svc-1": 150, "svc-2": 100, "svc-3": 220, "svc-4": 200, "svc-5": 100, "svc-6": 180,
  };
  const apptData = [
    // Geçmiş — tamamlandı
    { id: "appt-1", barberId: "barber-1", serviceId: "svc-1", customerId: "cust-1", date: new Date("2026-06-01"), startTime: "10:00", endTime: "10:30", status: "completed" },
    { id: "appt-2", barberId: "barber-2", serviceId: "svc-3", customerId: "cust-2", date: new Date("2026-06-01"), startTime: "11:00", endTime: "11:50", status: "completed" },
    { id: "appt-3", barberId: "barber-1", serviceId: "svc-4", customerId: "cust-3", date: new Date("2026-06-02"), startTime: "09:00", endTime: "09:45", status: "completed" },
    { id: "appt-4", barberId: "barber-2", serviceId: "svc-2", customerId: "cust-4", date: new Date("2026-06-03"), startTime: "14:00", endTime: "14:20", status: "completed" },
    { id: "appt-5", barberId: "barber-1", serviceId: "svc-6", customerId: "cust-5", date: new Date("2026-06-04"), startTime: "15:00", endTime: "15:40", status: "completed" },
    { id: "appt-6", barberId: "barber-2", serviceId: "svc-1", customerId: "cust-6", date: new Date("2026-06-05"), startTime: "10:30", endTime: "11:00", status: "completed" },
    { id: "appt-7", barberId: "barber-1", serviceId: "svc-3", customerId: "cust-7", date: new Date("2026-06-06"), startTime: "11:30", endTime: "12:20", status: "completed" },
    { id: "appt-8", barberId: "barber-2", serviceId: "svc-4", customerId: "cust-1", date: new Date("2026-06-07"), startTime: "09:30", endTime: "10:15", status: "completed" },
    { id: "appt-9", barberId: "barber-1", serviceId: "svc-1", customerId: "cust-2", date: new Date("2026-06-08"), startTime: "16:00", endTime: "16:30", status: "completed" },
    { id: "appt-10", barberId: "barber-2", serviceId: "svc-3", customerId: "cust-3", date: new Date("2026-06-09"), startTime: "10:00", endTime: "10:50", status: "completed" },
    { id: "appt-11", barberId: "barber-1", serviceId: "svc-2", customerId: "cust-4", date: new Date("2026-06-10"), startTime: "11:00", endTime: "11:20", status: "completed" },
    // İptal edilmiş
    { id: "appt-12", barberId: "barber-2", serviceId: "svc-1", customerId: "cust-5", date: new Date("2026-06-05"), startTime: "13:00", endTime: "13:30", status: "cancelled" },
    { id: "appt-13", barberId: "barber-1", serviceId: "svc-4", customerId: "cust-6", date: new Date("2026-06-08"), startTime: "14:30", endTime: "15:15", status: "cancelled" },
    // Bugün
    { id: "appt-14", barberId: "barber-1", serviceId: "svc-1", customerId: "cust-7", date: new Date("2026-06-11"), startTime: "09:00", endTime: "09:30", status: "completed" },
    { id: "appt-15", barberId: "barber-2", serviceId: "svc-3", customerId: "cust-1", date: new Date("2026-06-11"), startTime: "10:00", endTime: "10:50", status: "confirmed" },
    { id: "appt-16", barberId: "barber-1", serviceId: "svc-2", customerId: "cust-2", date: new Date("2026-06-11"), startTime: "11:00", endTime: "11:20", status: "pending" },
    { id: "appt-17", barberId: "barber-2", serviceId: "svc-4", customerId: "cust-3", date: new Date("2026-06-11"), startTime: "14:00", endTime: "14:45", status: "pending" },
    // Yarın
    { id: "appt-18", barberId: "barber-1", serviceId: "svc-3", customerId: "cust-4", date: new Date("2026-06-12"), startTime: "09:30", endTime: "10:20", status: "confirmed" },
    { id: "appt-19", barberId: "barber-2", serviceId: "svc-1", customerId: "cust-5", date: new Date("2026-06-12"), startTime: "11:00", endTime: "11:30", status: "pending" },
  ];

  for (const a of apptData) {
    await db.appointment.upsert({
      where: { id: a.id },
      update: { appointmentPrice: svcPrices[a.serviceId] ?? 0 },
      create: { ...a, appointmentPrice: svcPrices[a.serviceId] ?? 0 },
    });
  }

  // Müşteri istatistiklerini güncelle
  await db.customer.update({ where: { id: "cust-1" }, data: { completedCount: 2, totalAppointments: 3 } });
  await db.customer.update({ where: { id: "cust-2" }, data: { completedCount: 2, totalAppointments: 3 } });
  await db.customer.update({ where: { id: "cust-3" }, data: { completedCount: 2, totalAppointments: 3 } });
  await db.customer.update({ where: { id: "cust-4" }, data: { completedCount: 2, totalAppointments: 3 } });
  await db.customer.update({ where: { id: "cust-5" }, data: { completedCount: 1, totalAppointments: 2 } });
  await db.customer.update({ where: { id: "cust-6" }, data: { completedCount: 1, totalAppointments: 2 } });
  await db.customer.update({ where: { id: "cust-7" }, data: { completedCount: 2, totalAppointments: 2 } });

  console.log("✅ Seed tamamlandı!");
  console.log("👤 Admin: admin@boss.com / boss2024");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
