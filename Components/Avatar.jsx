import React from "react";

// A colour and an initial derived from the address, so the same person looks
// the same everywhere without storing an image.
const hue = (seed) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
};

const Avatar = ({ name = "", address = "", size = 40 }) => (
  <span
    className="avatar"
    aria-hidden="true"
    style={{
      width: size,
      height: size,
      fontSize: size * 0.42,
      background: `hsl(${hue(address || name)} 45% 38%)`,
    }}
  >
    {(name || address.slice(2) || "?").charAt(0).toUpperCase()}
  </span>
);

export default Avatar;
