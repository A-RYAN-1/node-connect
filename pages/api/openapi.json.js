import { spec } from "../../lib/server/openapi";

export default function handler(req, res) {
  res.setHeader("cache-control", "public, max-age=300");
  res.status(200).json(spec);
}
