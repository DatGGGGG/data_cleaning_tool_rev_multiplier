import { NextResponse } from "next/server";
import { requireMappingArtifactCapability } from "@/lib/mapping-artifacts/auth";
import { getSpecialCaseJob } from "@/lib/special-cases/server";
export async function GET(request:Request,{params}:{params:Promise<{jobId:string}>}) { try { await requireMappingArtifactCapability(request,"read");return NextResponse.json({job:await getSpecialCaseJob((await params).jobId)},{headers:{"Cache-Control":"no-store"}}); } catch(error) { return NextResponse.json({error:{message:error instanceof Error?error.message:"Could not load job."}},{status:(error as {status?:number})?.status??500}); } }
