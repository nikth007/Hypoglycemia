/** @type {import('next').NextConfig} */
const nextConfig = {
  // model JSON is read on the server only
  outputFileTracingIncludes: { "/api/**": ["./models/**"] },
};
export default nextConfig;
