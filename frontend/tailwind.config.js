/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50:"#f0f0ff",100:"#e0dfff",200:"#c7c3f8",300:"#a89ef3",
          400:"#8878ec",500:"#4f46e5",600:"#4338ca",700:"#3730a3",
          800:"#312e81",900:"#1e1b4b",
        },
      },
      fontFamily:{sans:["Inter","system-ui","sans-serif"]},
      boxShadow:{
        card:"0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04)",
        "card-hover":"0 4px 16px rgba(0,0,0,0.1)",
        "card-lg":"0 8px 30px rgba(0,0,0,0.08)",
      },
      animation:{"fade-in":"fadeIn 0.2s ease-out"},
      keyframes:{fadeIn:{"0%":{opacity:0,transform:"translateY(4px)"},"100%":{opacity:1,transform:"translateY(0)"}}},
    },
  },
  plugins: [],
};
