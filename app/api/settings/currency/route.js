import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// Available currencies
const CURRENCIES = [
  { code: "PKR", symbol: "PKR", name: "Pakistani Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
];

export async function GET() {
  try {
    // Currency settings ko fetch karo (key pattern: currency_*)
    const currencySettings = await prisma.settings.findMany({
      where: {
        key: {
          startsWith: "currency_",
        },
      },
    });

    // Agar koi currency setting nahi hai, to default create karo
    if (currencySettings.length === 0) {
      const defaultSetting = await prisma.settings.create({
        data: {
          key: "currency_default",
          value: "PKR",
          description: "Default application currency",
        },
      });

      return NextResponse.json({
        data: {
          defaultCurrency: "PKR",
          currencySymbol: "PKR",
          currencyName: "Pakistani Rupee",
          availableCurrencies: CURRENCIES,
          settings: [defaultSetting],
        },
        status: 200,
      });
    }

    // Default currency setting dhundo
    const defaultCurrencySetting = currencySettings.find(
      (s) => s.key === "currency_default"
    );

    const currentCurrencyCode = defaultCurrencySetting?.value || "PKR";
    const currentCurrency = CURRENCIES.find(
      (c) => c.code === currentCurrencyCode
    ) || CURRENCIES[0];

    return NextResponse.json({
      data: {
        defaultCurrency: currentCurrency.code,
        currencySymbol: currentCurrency.symbol,
        currencyName: currentCurrency.name,
        availableCurrencies: CURRENCIES,
        settings: currencySettings,
      },
      status: 200,
    });
  } catch (error) {
    console.error("Currency fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch currency settings" },
      { status: 500 }
    );
  }
}

export const PUT = guard("settings.manage", async (request) => {
  try {
    const body = await request.json();
    const { currencyCode } = body;

    if (!currencyCode) {
      return NextResponse.json(
        { error: "currencyCode is required" },
        { status: 400 }
      );
    }

    // Validate currency code
    const validCurrency = CURRENCIES.find((c) => c.code === currencyCode);
    if (!validCurrency) {
      return NextResponse.json(
        { error: "Invalid currency code" },
        { status: 400 }
      );
    }

    // Check if setting exists
    const existingSetting = await prisma.settings.findUnique({
      where: { key: "currency_default" },
    });

    let updatedSetting;

    if (existingSetting) {
      // Update existing setting
      updatedSetting = await prisma.settings.update({
        where: { key: "currency_default" },
        data: {
          value: currencyCode,
          last_updated: new Date(),
        },
      });
    } else {
      // Create new setting
      updatedSetting = await prisma.settings.create({
        data: {
          key: "currency_default",
          value: currencyCode,
          description: "Default application currency",
        },
      });
    }

    return NextResponse.json({
      data: {
        setting: updatedSetting,
        currency: validCurrency,
      },
      status: 200,
    });
  } catch (error) {
    console.error("Currency update error:", error);
    return NextResponse.json(
      { error: "Failed to update currency" },
      { status: 500 }
    );
  }
});