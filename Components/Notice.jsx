import React from "react";

const Notice = ({ message, onClose }) => (
  <div className="notice" role="alert">
    <p>{message}</p>
    <button type="button" onClick={onClose}>
      Dismiss
    </button>
  </div>
);

export default Notice;
