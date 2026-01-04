import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'About & Methodology - Chicago Style Checker',
}

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-[#fcfbf7] p-8 font-ui text-[#1a1a1a]">
            <div className="max-w-3xl mx-auto">
                <div className="mb-12">
                    <Link
                        href="/"
                        className="text-xs uppercase tracking-widest text-gray-500 hover:text-brand-red transition-colors inline-block mb-10 font-semibold"
                    >
                        ← Back to Checker
                    </Link>
                    <h1 className="text-4xl font-academic font-normal text-gray-900 mb-2 tracking-tight">
                        About & Methodology
                    </h1>
                </div>

                <div className="font-academic text-[#1a1a1a] space-y-12 leading-relaxed text-lg pb-24">
                    <section>
                        <h2 className="text-2xl font-normal mb-6 text-gray-900 border-b border-gray-100 pb-2">What this tool does</h2>
                        <p className="mb-6">
                            Chicago Style Checker is a lightweight editorial tool designed to assist with technical revisions according to Chicago style conventions. It focuses on formal correctness—such as punctuation, spacing, capitalization, and quotation practices—without altering meaning, argument, or authorial voice.
                        </p>
                        <p className="mb-6">
                            This project is developed and maintained by an independent developer and currently in beta. It is intended as a supportive editorial aid rather than a replacement for professional copyediting or authoritative style manuals.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-6 text-gray-900 border-b border-gray-100 pb-2">How it works</h2>
                        <p className="mb-6 text-gray-700 font-ui text-base">
                            This tool is powered by Groq-hosted LLMs, specifically:
                        </p>
                        <div className="bg-white p-6 border border-gray-100 rounded-sm mb-6">
                            <code className="text-sm font-mono text-brand-red">llama-3.3-70b-versatile</code>
                        </div>
                        <p className="mb-6 text-gray-700">
                            During internal testing, requests are processed using a rate-limited API configuration.
                            The model analyzes the input text and returns:
                        </p>
                        <ul className="list-disc pl-5 space-y-3 mb-6 font-ui text-[15px] text-gray-600">
                            <li>a suggested technical revision of the original input</li>
                            <li>a list of detected edits with Chicago-style justifications</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-6 text-gray-900 border-b border-gray-100 pb-2">Output format</h2>
                        <p className="mb-6">Each submission produces:</p>
                        <ul className="list-disc pl-5 font-ui text-[15px] text-gray-600 space-y-3 mb-6">
                            <li><strong className="text-gray-900 font-semibold">Revised text:</strong> a suggested technical revision of the original input</li>
                            <li><strong className="text-gray-900 font-semibold">Changes:</strong> an itemized list of detected edits (e.g., spelling, punctuation, style)</li>
                            <li><strong className="text-gray-900 font-semibold">Highlights (optional):</strong> visual indicators showing where changes occurred</li>
                        </ul>
                        <p className="text-gray-700 italic text-base">
                            In some cases—especially when text is reordered or restructured—changes may be reflected in the revised text without being fully localized in the change list.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-6 text-gray-900 border-b border-gray-100 pb-2">Data & Privacy</h2>
                        <p className="mb-6 text-gray-700">
                            Submitted text is processed solely to generate suggestions and is not stored permanently.
                            Please avoid submitting sensitive or confidential material.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-6 text-gray-900 border-b border-gray-100 pb-2">Roadmap</h2>
                        <p className="mb-6">Planned improvements include:</p>
                        <ul className="list-disc pl-5 font-ui text-[15px] text-gray-600 space-y-3">
                            <li>more consistent and transparent change tracking,</li>
                            <li>improved handling of structural edits, and</li>
                            <li>a Bring Your Own Key (BYOK) option for advanced users.</li>
                        </ul>
                    </section>

                    <section>
                        <div className="bg-white p-8 border border-gray-100 rounded-sm shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-brand-red"></div>
                            <h2 className="text-xl font-academic font-normal mb-4 text-gray-900">Feedback & Collaboration</h2>
                            <div className="font-ui text-sm text-gray-600 space-y-4 mb-6">
                                <p>
                                    This project is an experimental endeavor. Feedback is essential for refining its accuracy and reliability.
                                </p>
                                <p>
                                    The developer welcomes technical discussions or potential collaborations with fellow engineers and editors.
                                </p>
                            </div>
                            <a
                                href="https://forms.gle/kt8CLYoZRsdESXyh7"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-xs uppercase tracking-[0.2em] font-bold text-brand-red hover:text-brand-red-dark transition-colors"
                            >
                                Submit Feedback →
                            </a>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
