(function () {
  var form = document.querySelector('[data-contact-form]')

  if (
    !form ||
    !window.fetch ||
    !window.FormData ||
    !window.FormData.prototype.forEach
  ) {
    return
  }

  var submitButton = form.querySelector('[data-contact-form-submit]')
  var errorMessage = form.querySelector('[data-contact-form-error]')
  var successMessage = document.querySelector('[data-contact-form-success]')
  var submissionEndpoint = form.getAttribute('data-contact-form-endpoint')

  if (!submissionEndpoint) {
    return
  }

  form.addEventListener('submit', function (event) {
    var submission = {}
    var formData = new window.FormData(form)

    formData.forEach(function (value, name) {
      submission[name] = value
    })

    event.preventDefault()

    errorMessage.hidden = true
    submitButton.disabled = true
    submitButton.textContent = 'Sending…'
    form.setAttribute('aria-busy', 'true')

    window.fetch(submissionEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(submission)
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Form submission failed')
      }

      form.hidden = true
      successMessage.hidden = false
      successMessage.focus()
    }).catch(function () {
      errorMessage.hidden = false
      errorMessage.focus()
      submitButton.disabled = false
      submitButton.textContent = 'Submit'
    }).then(function () {
      form.removeAttribute('aria-busy')
    })
  })
})()
