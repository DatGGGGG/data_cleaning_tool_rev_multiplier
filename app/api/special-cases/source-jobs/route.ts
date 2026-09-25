import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { startSpecialCaseSourceJob } from "@/lib/special-cases/server";
export async function POST(request:Request) { try { const principal=await requireMappingArtifactCapability(request,"commit");const body=await request.json() as {fullArtifactId?:string};if(!body.fullArtifactId) throw new Error("Select a committed Full Mapping artifact.");return NextResponse.json({job:await startSpecialCaseSourceJob(body.fullArtifactId,principal.displayName)}); } catch(error) { return NextResponse.json({error:{message:error instanceof Error?error.message:"Could not start source load."}},{status:(error as {status?:number})?.status??500}); } }
