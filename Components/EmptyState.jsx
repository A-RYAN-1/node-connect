import React from "react";

const EmptyState = ({ title, text, children }) => (
  <div className="panel empty">
    <h2>{title}</h2>
    <p>{text}</p>
    {children}
  </div>
);

export default EmptyState;
