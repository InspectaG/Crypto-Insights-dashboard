import { fetchMarketData } from "../../../worker/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const market = await fetchMarketData();
    const timestamps = market.map((asset) => new Date(asset.observedAt).getTime());
    return Response.json(
      {
        assets: market.map((asset) => ({
          symbol: asset.symbol,
          name: asset.name,
          price: asset.priceLabel,
          change: asset.changeLabel,
          volume: asset.volumeLabel,
          bias: asset.bias,
          bars: asset.bars,
        })),
        status: "live",
        source: "Coinbase Exchange",
        asOf: new Date(Math.min(...timestamps)).toISOString(),
        refreshSeconds: 30,
        message: "Validated Coinbase ticker quotes with 24-hour Exchange statistics.",
      },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch {
    return Response.json(
      {
        status: "unavailable",
        source: "Coinbase Exchange",
        asOf: null,
        refreshSeconds: 30,
        message: "Coinbase market data is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
