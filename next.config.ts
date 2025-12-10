import type { NextConfig } from "next";
import type { RemotePattern } from "next/dist/shared/lib/image-config";

const supabaseRemotePatterns: RemotePattern[] = (() => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return [];
  try {
    const { hostname, protocol } = new URL(supabaseUrl);
    const normalizedProtocol = protocol.replace(":", "");
    const nextProtocol = normalizedProtocol === "http" ? "http" : "https";
    return [
      {
        protocol: nextProtocol,
        hostname,
        pathname: "/storage/v1/object/public/thumbnails/**",
      },
    ];
  } catch {
    return [];
  }
})();

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: supabaseRemotePatterns,
  },
};

export default nextConfig;
