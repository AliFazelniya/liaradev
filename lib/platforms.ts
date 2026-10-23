// Platform ids/labels as used by Liara's create-app wizard (read from the console).
export interface Platform {
  id: string;
  name: string;
  logo: string; // /assets/platforms/*
  port: number;
}

export const PLATFORMS: Platform[] = [
  { id: "node", name: "NODEJS", logo: "nodejs.png", port: 3000 },
  { id: "next", name: "NEXTJS", logo: "nextjs.png", port: 3000 },
  { id: "laravel", name: "LARAVEL", logo: "laravel.png", port: 80 },
  { id: "php", name: "PHP", logo: "php.png", port: 80 },
  { id: "python", name: "PYTHON", logo: "python.png", port: 8000 },
  { id: "django", name: "DJANGO", logo: "django.png", port: 8000 },
  { id: "flask", name: "FLASK", logo: "flask.png", port: 5000 },
  { id: "netcore", name: "‎.NET", logo: "dotnet.png", port: 80 },
  { id: "react", name: "REACT", logo: "react.png", port: 80 },
  { id: "angular", name: "ANGULAR", logo: "angular.png", port: 80 },
  { id: "vue", name: "VUE", logo: "vuejs.png", port: 80 },
  { id: "static", name: "STATIC", logo: "static.png", port: 80 },
  { id: "go", name: "GO", logo: "golang.png", port: 8080 },
  { id: "docker", name: "DOCKER", logo: "docker.png", port: 80 },
];

export const platformLogo = (id: string) => `/assets/platforms/${PLATFORMS.find((p) => p.id === id || (id === "dotnet" && p.id === "netcore"))?.logo ?? "nodejs.png"}`;

export const BUNDLE_TABS = [
  { id: "basic", label: "پایه" },
  { id: "standard", label: "نقره‌ای" },
  { id: "pro", label: "طلایی" },
];
// how the console names the bundle on an app's overview page
export const BUNDLE_NAME: Record<string, string> = { basic: "برنزی", standard: "نقره‌ای", pro: "طلایی" };

export const PLANET_IMG: Record<string, string> = {
  زمین: "earth.png", مریخ: "mars.png", مشتری: "jupiter.png", زحل: "saturn.png", اورانوس: "uranus.png", نپتون: "neptune.png", پلوتون: "pluto.webp",
};

export const VAT = 0.1; // shown by the console as "مالیات بر ارزش افزوده (۱۰٪)"
