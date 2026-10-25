export function PdfMenuFontSize({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[12px] font-semibold text-[#c0c0c0] mb-2">Letra de la tabla del menú</legend>
      <div className="flex gap-2">
        {[
          { label: 'Estándar', size: 11 },
          { label: 'Mediana', size: 12 },
          { label: 'Letra grande', size: 13.5 },
        ].map(({ label, size }) => (
          <button key={size} type="button" aria-pressed={value === size} onClick={() => onChange(size)}
            className={`flex-1 rounded-[8px] border px-2 py-2 text-[12px] font-medium transition-colors ${value === size ? 'bg-brand-primary text-black border-brand-primary' : 'bg-[#111] text-[#c0c0c0] border-[#333] hover:bg-[#222]'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[#8a8a8a]">El tamaño cambia las tablas del menú. Si aparece primero el historial, baja hasta las hojas del menú para ver la diferencia.</p>
    </fieldset>
  );
}
