// Cálculo de dias úteis (base das regras RN03 e RN11).
// Datas de negócio trafegam como string 'YYYY-MM-DD' para evitar problemas de fuso.
// Dia útil = não é sábado/domingo e não consta na tabela `feriado`
// (nacional, estadual, municipal ou facultativo).

export type DataISO = string; // 'YYYY-MM-DD'

const DIA_MS = 86_400_000;

function parse(iso: DataISO): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function format(ms: number): DataISO {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Converte um instante (ex.: timestamp do banco) na data de negócio no fuso informado. */
export function dataLocal(instante: Date, timeZone = 'America/Bahia'): DataISO {
  // 'en-CA' formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(instante);
}

export class CalendarioUtil {
  constructor(private readonly feriados: ReadonlySet<DataISO>) {}

  isDiaUtil(iso: DataISO): boolean {
    const dow = new Date(parse(iso)).getUTCDay(); // 0 = dom, 6 = sáb
    return dow !== 0 && dow !== 6 && !this.feriados.has(iso);
  }

  /** Soma `n` dias úteis a partir de `inicio` (o dia de início não conta). */
  somarDiasUteis(inicio: DataISO, n: number): DataISO {
    if (n < 0) throw new RangeError('n deve ser >= 0');
    let atual = parse(inicio);
    let restantes = n;
    while (restantes > 0) {
      atual += DIA_MS;
      if (this.isDiaUtil(format(atual))) restantes--;
    }
    return format(atual);
  }

  /**
   * Quantidade de dias úteis no intervalo (inicio, fim]:
   * exclui o dia de início, inclui o dia final.
   * Retorna 0 se fim <= inicio.
   */
  diasUteisEntre(inicio: DataISO, fim: DataISO): number {
    let atual = parse(inicio);
    const limite = parse(fim);
    let total = 0;
    while (atual < limite) {
      atual += DIA_MS;
      if (this.isDiaUtil(format(atual))) total++;
    }
    return total;
  }
}
