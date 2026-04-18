import React from 'react';

// To jest rekonstrukcja logo PKO z obrazka za pomocą SVG.
// Jest ostre, skalowalne i ma poprawne kolory.
export const PkoLogoIcon = ({ size = 18, style = {} }) => {
  // Wyliczamy proporcje, aby logo pasowało do podanego rozmiaru (size)
  const width = size;
  const height = size;
  const viewBox = "0 0 100 100"; // Wewnętrzny układ współrzędnych SVG

  return (
    <svg 
      width={width} 
      height={height} 
      viewBox={viewBox} 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      style={{ ...style, flexShrink: 0 }} // flexShrink zapobiega zgniataniu w flexboksie
      aria-label="PKO BP Logo"
    >
      {/* 1. Tło - Biały kwadrat z zaokrąglonymi rogami i cieniem */}
      <defs>
        <filter id="iko_shadow" x="-5" y="-5" width="110" height="110" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix"/>
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <feOffset dy="2"/>
          <feGaussianBlur stdDeviation="3"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0"/>
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_2"/>
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_2" result="shape"/>
        </filter>
      </defs>
      
      {/* Tło karty */}
      <rect x="5" y="5" width="90" height="90" rx="16" fill="white" filter="url(#iko_shadow)" />
      
      {/* 2. Czerwona kropka (Głowa człowieka) */}
      <circle cx="50" cy="40" r="15" fill="#e31e24" />
      
      {/* 3. Granatowy gradientowy wiersz (Tułów) */}
      <defs>
        <linearGradient id="iko_line_grad" x1="28" y1="62" x2="72" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0a1226"/> {/* Ciemny granat - lewa */}
          <stop offset="1" stopColor="#0037a3"/> {/* Jaśniejszy granat - prawa */}
        </linearGradient>
      </defs>
      <rect x="30" y="62" width="40" height="8" rx="4" fill="url(#iko_line_grad)" />
    </svg>
  );
};