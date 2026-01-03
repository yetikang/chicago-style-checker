import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
    title: 'About & Methodology - Chicago Style Checker',
}

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-white p-8">
            <div className="max-w-3xl mx-auto">
                <div className="mb-10">
                    <Link
                        href="/"
                        className="text-sm text-gray-600 font-serif hover:text-brand-red transition-colors inline-block mb-6"
                    >
                        ← Back to Checker
                    </Link>
                    <h1 className="text-4xl font-serif font-normal text-gray-900 mb-2">
                        About & Methodology
                    </h1>
                </div>

                <div className="font-serif text-gray-900 space-y-10 leading-relaxed text-lg">
                    <section>
                        <h2 className="text-2xl font-normal mb-4">What this tool does</h2>
                        <p className="mb-4">
                            Chicago Style Checker is an experimental writing assistant for technical revision aligned with the Chicago Manual of Style (17th edition).

                        </p>
                        <p className="mb-4">
                            It focuses on formal issues such as punctuation, capitalization, abbreviations, citation phrasing, and consistency.
                            It does not evaluate, revise, or interpret the substantive content or argument of the text.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-4">How it works</h2>
                        <p className="mb-4">
                            This tool is powered by Groq-hosted LLMs, specifically:
                            <br />
                            <code className="text-base bg-gray-100 px-1.5 py-0.5 rounded">llama-3.3-70b-versatile</code> (on-demand)
                        </p>
                        <p className="mb-4">
                            During internal testing, requests are processed using a free-tier API key with token limits.
                            The model analyzes the input text and returns:
                        </p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>a suggested revised version of the text, and</li>
                            <li>a list of notable technical or stylistic changes with brief explanations.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-4">Output format</h2>
                        <p className="mb-4">Each submission produces:</p>
                        <ul className="list-disc pl-5 space-y-2 mb-4">
                            <li><strong>Revised text:</strong> a suggested technical revision of the original input</li>
                            <li><strong>Changes:</strong> an itemized list of detected edits (e.g., spelling, punctuation, style)</li>
                            <li><strong>Highlights (optional):</strong> visual indicators showing where changes occurred</li>
                        </ul>
                        <p>
                            In some cases—especially when text is reordered or restructured—changes may be reflected in the revised text without being fully localized in the change list.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-4">Data & privacy</h2>
                        <p className="mb-4">
                            Submitted text is processed solely to generate suggestions and is not intended to be stored permanently.
                            Please avoid submitting sensitive or confidential material.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-normal mb-4">Roadmap</h2>
                        <p className="mb-4">Planned improvements may include:</p>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>more consistent and transparent change tracking,</li>
                            <li>improved handling of structural edits, and</li>
                            <li>a Bring Your Own Key (BYOK) option allowing users to supply their own API credentials.</li>
                        </ul>
                    </section>

                    <section>
                        <div className="bg-gray-50 p-6 border border-gray-200 rounded-sm">
                            <h2 className="text-2xl font-normal mb-4">Feedback</h2>
                            <p className="mb-4">
                                This project is independently developed and maintained by the author through an experimental process.
                            </p>
                            <p className="mb-4">
                                Feedback is especially valuable in helping identify issues and improve reliability.
                            </p>
                            <p className="mb-4">
                                The author also welcomes discussion and potential collaboration with others who have programming or related technical expertise.
                            </p>
                            <a
                                href="https://forms.gle/p46m21L8oU3KgCdc6"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-brand-red hover:underline break-all"
                            >
                                https://forms.gle/p46m21L8oU3KgCdc6
                            </a>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
