/* إعدادات Supabase — ضع هنا المفتاح العام فقط (anon / publishable).
   لا تضع service_role أبدًا. المفتاح العام آمن للنشر لأن الحماية في سياسات RLS. */
window.MK_CONFIG = {
  url: "https://hozfvgtghbknszbgfnly.supabase.co/rest/v1/",     // مثال: https://abcdefghijk.supabase.co
  anonKey: "sb_publishable_l9_SfzFZhqno1Iu8NXAsvw_p3MjIYzx",  // المفتاح العام (anon public / publishable)
  // روابط تحميل التطبيق تظهر في شاشة الدخول. اتركها فارغة "" فيظهر زر «قريبًا»، وضع الرابط الكامل (https://...) متى جهز.
  downloads: {
    android: "",   // رابط ملف APK أو صفحة Google Play
    ios: "",       // رابط App Store أو TestFlight
    windows: ""    // رابط ملف التثبيت (exe/msi) أو Microsoft Store
  }
};
