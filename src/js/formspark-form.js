(function () {
  var submissionTimeoutMs = 30000
  var form = document.querySelector('[data-formspark-form]')

  if (
    !form ||
    !window.fetch ||
    !window.FormData ||
    !window.FormData.prototype.forEach
  ) {
    return
  }

  var submitButton = form.querySelector('[data-formspark-form-submit]')
  var errorMessage = form.querySelector('[data-formspark-form-error]')
  var progressMessage = document.querySelector('[data-formspark-form-progress]')
  var successMessage = document.querySelector('[data-formspark-form-success]')
  var progressText = form.getAttribute('data-formspark-form-progress-message')

  if (!submitButton || !errorMessage || !successMessage || !form.action) {
    return
  }

  var submitButtonText = submitButton.textContent.trim()

  form.addEventListener('submit', function (event) {
    var submission = {}
    var formData = new window.FormData(form)

    formData.forEach(function (value, name) {
      submission[name] = value
    })

    event.preventDefault()

    errorMessage.classList.remove('is-visible')
    submitButton.disabled = true
    submitButton.textContent = 'Sending…'
    form.setAttribute('aria-busy', 'true')
    if (progressMessage) {
      progressMessage.textContent = progressText || 'Sending your form.'
    }

    var abortController = window.AbortController
      ? new window.AbortController()
      : null
    var timeoutId
    var requestOptions = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(submission)
    }

    if (abortController) {
      requestOptions.signal = abortController.signal
    }

    var timeout = new window.Promise(function (resolve, reject) {
      timeoutId = window.setTimeout(function () {
        if (abortController) {
          abortController.abort()
        }

        reject(new Error('Form submission timed out'))
      }, submissionTimeoutMs)
    })

    window.Promise.race([
      window.fetch(form.action, requestOptions),
      timeout
    ]).then(function (response) {
      if (!response.ok) {
        throw new Error('Form submission failed')
      }

      form.hidden = true
      successMessage.hidden = false
      successMessage.focus()
    }).catch(function () {
      errorMessage.classList.add('is-visible')
      errorMessage.focus()
      submitButton.disabled = false
      submitButton.textContent = submitButtonText
    }).then(function () {
      window.clearTimeout(timeoutId)
      form.removeAttribute('aria-busy')
      if (progressMessage) {
        progressMessage.textContent = ''
      }
    })
  })
})()
