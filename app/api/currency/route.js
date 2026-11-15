import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const currencyCode = url.searchParams.get("currency_code")?.toUpperCase();
    const search = url.searchParams.get("search")?.toUpperCase();

    const response = await fetch(
      "https://raw.githubusercontent.com/fawazahmed0/exchange-api/main/other/currencies.json"
    );

    const data = await response.json();

    let currencies = Object.entries(data).map(([code, name]) => ({
      currency_code: code.toUpperCase(),
      currency_name: name,
    }));

    if (currencyCode) {
      currencies = currencies.filter((c) => c.currency_code === currencyCode);
    }

    if (search) {
      currencies = currencies.filter((c) =>
        c.currency_code.includes(search) ||
        c.currency_name.toUpperCase().includes(search)
      );
    }

    return NextResponse.json(currencies);
  } catch (error) {
    console.error("Currency API Error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}